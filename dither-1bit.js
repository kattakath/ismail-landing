// 1-bit dither fields — pure #000/#fff, no greys. Tone is carried entirely by an
// 8x8 Bayer threshold (the Duochrome hatch device), never by alpha or grey fills.
//
// Custom elements sharing ONE guarded WebGL harness (Field1Bit):
//   <metaball-field> — the hero's metaball/curl-flow panel; moves only under the pointer.
//   <dither-field>   — a static domain-warped "plate-mark" for the contact band.
//   <card-field>     — a pointer halo for ink cards.
//
// The dither math (hash/value-noise/fbm/Bayer) lives once in LIB and is prepended to
// every fragment shader. The Bayer recursion is after basement.studio's shader-lab
// dither-textures (Apache-2.0) — function only, no framework: raw WebGL 1.
//
// Motion is interaction-gated: nothing auto-plays, so WCAG 2.2.2 needs no Pause control.
// The rAF loop runs ONLY while a field still has motion to show; it stops when the field
// settles, scrolls off-screen, the tab hides, or prefers-reduced-motion is set, and it
// re-arms from pointer wake, IntersectionObserver entry, visibilitychange and the
// reduced-motion query. A null context, a failed shader link or a lost context all fall
// back to the container's own (ink) background.
(function () {
  if (customElements.get('metaball-field')) return;

  // Shared GLSL prelude — the 1-bit dither kernel, defined once (DRY).
  const LIB = `precision highp float;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float vnoise(vec2 p){vec2 i=floor(p),f=fract(p);vec2 u=f*f*(3.-2.*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),u.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),u.x),u.y);}
float fbm(vec2 p){float s=0.,a=.5;for(int i=0;i<5;i++){s+=a*vnoise(p);p*=2.03;a*=.5;}return s;}
float bayer2(vec2 a){a=floor(a);return fract(a.x/2.+a.y*a.y*.75);}
float dither8(vec2 b){return ((bayer2(b*.25)*.25+bayer2(b*.5))*.25+bayer2(b))*1.523;}`;

  const VERT = `attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}`;

  // ── Base harness ───────────────────────────────────────────────────────────
  // One-time GL setup (_setup) is split from attach/detach, so an element that is
  // removed and re-inserted re-arms its observers and loop. A subclass supplies FRAG +
  // UNIFORMS and may override the knobs and hooks below.
  class Field1Bit extends HTMLElement {
    // knobs — subclasses override
    get maxDPR() { return 2; }
    get fps() { return 30; }
    get pointerHome() { return [0.5, 0.5]; }
    get staticTime() { return 0; }
    // true while the field still has motion to show; the loop stops when it turns false
    get wantsFrames() { return false; }

    connectedCallback() {
      if (!this._setupDone) this._setup();
      if (this.gl) this._attach();
    }

    disconnectedCallback() { this._detach(); }

    _setup() {
      this._setupDone = true;
      this.style.display = 'block';
      this.style.position = this.style.position || 'absolute';
      this.style.inset = this.style.inset || '0';

      const c = document.createElement('canvas');
      c.style.cssText = 'display:block;width:100%;height:100%';
      this.appendChild(c);
      this.canvas = c;

      const gl = c.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'low-power', preserveDrawingBuffer: true });
      if (!gl) return this._fallback();

      const sh = (type, src) => {
        const s = gl.createShader(type);
        gl.shaderSource(s, src); gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) console.warn(gl.getShaderInfoLog(s));
        return s;
      };
      const prog = gl.createProgram();
      gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
      gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, LIB + '\n' + this.constructor.FRAG));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        if (!gl.isContextLost()) console.warn(gl.getProgramInfoLog(prog));
        return this._fallback();
      }
      gl.useProgram(prog);

      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(prog, 'a');
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

      this.u = {};
      for (const name of this.constructor.UNIFORMS) this.u[name] = gl.getUniformLocation(prog, name);
      this.gl = gl;

      // A lost context gets the same fallback as no context at all.
      c.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this._detach(); this._fallback(); });

      this.pointer = this.pointerHome.slice();
      this._target = this.pointer.slice();
      this._interval = 1000 / this.fps;
      this._mq = matchMedia('(prefers-reduced-motion: reduce)');
      if (this.onInit) this.onInit(gl);
    }

    // Hide the canvas: the container's own background (ink) shows through.
    _fallback() {
      this.gl = null;
      if (this.canvas) this.canvas.style.display = 'none';
    }

    _attach() {
      if (this._attached) return;
      this._attached = true;
      this._visible = true;
      this._reduced = this._mq.matches;

      this._onMove = (e) => {
        const r = this.getBoundingClientRect();
        this._target = [(e.clientX - r.left) / r.width, 1 - (e.clientY - r.top) / r.height];
        this._wake(true);
      };
      this._onEnter = () => this._wake(true);
      this._onLeave = () => { this._target = this.pointerHome.slice(); this._wake(false); };
      this.addEventListener('pointerenter', this._onEnter);
      this.addEventListener('pointermove', this._onMove);
      this.addEventListener('pointerleave', this._onLeave);

      this._ro = new ResizeObserver(() => this.resize());
      this._ro.observe(this);
      this._io = new IntersectionObserver((es) => {
        this._visible = es[es.length - 1].isIntersecting;
        if (this._visible) { this.draw(); this._arm(); }
      }, { threshold: 0 });
      this._io.observe(this);

      // Reduced motion is re-evaluated live, so a mid-session OS toggle applies at once.
      this._onMQ = (e) => { this._reduced = e.matches; this.draw(); this._arm(); };
      this._mq.addEventListener('change', this._onMQ);
      this._onVis = () => { if (!document.hidden) this._arm(); };
      document.addEventListener('visibilitychange', this._onVis);

      this.resize();
      this.draw();
    }

    _detach() {
      if (!this._attached) return;
      this._attached = false;
      cancelAnimationFrame(this._raf);
      this._raf = 0;
      this._ro.disconnect();
      this._io.disconnect();
      this._mq.removeEventListener('change', this._onMQ);
      document.removeEventListener('visibilitychange', this._onVis);
      this.removeEventListener('pointerenter', this._onEnter);
      this.removeEventListener('pointermove', this._onMove);
      this.removeEventListener('pointerleave', this._onLeave);
    }

    _wake(active) {
      this._active = active;
      this._arm();
    }

    _canRun() {
      return !!this.gl && this._attached && this._visible && !this._reduced && !document.hidden && this.wantsFrames;
    }

    // The single entry point that starts the loop; a no-op if it is already running.
    _arm() {
      if (this._raf || !this._canRun()) return;
      this._last = performance.now();
      this._raf = requestAnimationFrame(this.frame);
    }

    // One rAF tick. Re-arms itself only while the field still wants frames.
    frame = (now) => {
      this._raf = 0;
      if (!this._canRun()) { this.draw(); return; } // settle on a final resting frame
      const dt = now - this._last;
      if (dt >= this._interval) { // frame-rate cap (perf + seizure safety)
        this._last = now;
        this.step(Math.min(dt, 100) / 1000);
        this.pointer[0] += (this._target[0] - this.pointer[0]) * 0.07;
        this.pointer[1] += (this._target[1] - this.pointer[1]) * 0.07;
        this.draw();
      }
      this._raf = requestAnimationFrame(this.frame);
    };

    // advance the subclass's own state by dt seconds
    step() {}

    resize() {
      if (!this.gl) return;
      const dpr = Math.min(devicePixelRatio || 1, this.maxDPR);
      const w = Math.max(1, Math.round(this.clientWidth * dpr));
      const h = Math.max(1, Math.round(this.clientHeight * dpr));
      if (w === this._w && h === this._h) return;
      this._w = w; this._h = h;
      this.canvas.width = w; this.canvas.height = h;
      this.gl.viewport(0, 0, w, h);
      this._dpr = dpr;
      this.draw();
    }

    draw() {
      const gl = this.gl, u = this.u;
      if (!gl || !this._w) return;
      if (u.u_res) gl.uniform2f(u.u_res, this._w, this._h);
      if (u.u_t) gl.uniform1f(u.u_t, this.time());
      if (u.u_p) gl.uniform2f(u.u_p, this.pointer[0], this.pointer[1]);
      if (u.u_inv) gl.uniform1f(u.u_inv, this.hasAttribute('invert') ? 1 : 0);
      if (u.u_px) gl.uniform1f(u.u_px, (parseFloat(this.getAttribute('dot')) || 2) * (this._dpr || 1));
      if (this.extraUniforms) this.extraUniforms(gl, u);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    time() { return this.staticTime; }
  }

  // Shared by the pointer-reactive fields: an energy scalar that blooms on contact and
  // decays after leave. The loop runs only until it has decayed to zero.
  const energyStep = (self, dt, up, down) => {
    const k = self._active ? up : down;               // per-60Hz-frame easing constant
    const a = 1 - Math.pow(1 - k, dt * 60);           // the same easing at any frame rate
    self._energy += ((self._active ? 1 : 0) - self._energy) * a;
    if (!self._active && self._energy < 0.004) self._energy = 0;
  };

  // ── <dither-field> — static plate-mark for the contact band ─────────────────
  // A marbled fbm, edge-weighted so coverage hugs the band's frame and stays sparse
  // through the centre. Content sits on solid-ink knockouts (styles.css), so text
  // never rides the dither — mandatory since opacity/scrim is banned.
  class DitherField extends Field1Bit {
    static UNIFORMS = ['u_res', 'u_t', 'u_inv', 'u_px'];
    static FRAG = `
uniform vec2 u_res;uniform float u_t;uniform float u_inv;uniform float u_px;
void main(){
  vec2 frag=gl_FragCoord.xy;
  vec2 uv=frag/u_res;
  vec2 p=vec2(uv.x*(u_res.x/u_res.y),uv.y);
  float t=u_t*.03;
  vec2 q=vec2(fbm(p*1.3+vec2(t,1.3)),fbm(p*1.3+vec2(-t,5.2)));
  float f=fbm(p*1.7+q*1.0+vec2(0.,t*.5));            // marbled scalar field
  // Plate-mark framing: dither hugs the top/bottom frame (and far L/R corners),
  // fading to open black through the centre band where the copy sits.
  float edge=smoothstep(0.30,1.0,abs(uv.y-.5)*2.0);
  edge=max(edge,smoothstep(0.86,1.0,abs(uv.x-.5)*2.0));
  float v=clamp((f-0.42)*1.55*edge,0.,1.);          // subtract -> sparse speckle
  float th=dither8(frag/u_px);
  float m=step(th,v)*step(.02,v);                   // m=1 -> white mark
  m=mix(m,1.-m,u_inv);
  gl_FragColor=vec4(vec3(m),1.);
}`;

    // A 1-bit plate needs no device pixels: render at CSS resolution and scale by
    // nearest-neighbour, so each dot stays a crisp square at a quarter of the fill cost.
    get maxDPR() { return 1; }
    get staticTime() { return 5.0; } // the fixed frame this plate holds
    onInit() { this.canvas.style.imageRendering = 'pixelated'; }
  }

  // ── <metaball-field> — interactive metaball/curl-flow panel (hero) ──────────
  // A per-fragment 2D metaball potential from 6 procedurally-orbiting centres + a
  // pointer attractor, coordinate-warped by divergence-free curl noise. The orbit
  // clock advances ONLY while the pointer is in the panel (and while it eases out), so
  // at rest it is a still composition and the loop is stopped.
  class MetaballField extends Field1Bit {
    static UNIFORMS = ['u_res', 'u_t', 'u_p', 'u_inv', 'u_px'];
    static FRAG = `
uniform vec2 u_res;uniform float u_t;uniform vec2 u_p;uniform float u_inv;uniform float u_px;
// a blob centre as a pure function of index + time (procedural orbit; no uniform arrays)
vec2 orbit(float i,float t){
  float a=i*2.399963;                 // golden-angle angular spread
  float sp=0.10+0.05*fract(i*0.37);   // per-blob orbital speed
  float rad=0.20+0.14*fract(i*0.61);  // per-blob orbit radius
  return vec2(0.5+rad*cos(t*sp+a)*1.25, 0.5+rad*sin(t*sp*1.3+a*1.7));
}
void main(){
  vec2 frag=gl_FragCoord.xy;
  vec2 uv=frag/u_res;
  float asp=u_res.x/u_res.y;
  vec2 p=vec2(uv.x*asp,uv.y);          // aspect-correct field space
  float t=u_t*0.6;
  // divergence-free curl warp (4 value-noise taps) -> gooey, flowing isosurface rims
  float e=0.035; vec2 g=vec2(0.0,t*0.15);
  float nx=vnoise(p*2.2+vec2(e,0.0)+g)-vnoise(p*2.2-vec2(e,0.0)+g);
  float ny=vnoise(p*2.2+vec2(0.0,e)+g)-vnoise(p*2.2-vec2(0.0,e)+g);
  vec2 wp=p+vec2(ny,-nx)/(2.0*e)*0.05;
  // metaball potential from 6 orbiting centres (epsilon guards div-by-zero)
  float F=0.0;
  for(int i=0;i<6;i++){
    vec2 c=orbit(float(i),t); c.x*=asp;
    vec2 d=wp-c;
    F+=0.013/(dot(d,d)+0.0016);
  }
  // pointer = an extra attractor blob: the cursor grows and pulls the ink toward it
  vec2 mp=u_p; mp.x*=asp;
  vec2 dm=wp-mp;
  F+=0.026/(dot(dm,dm)+0.0045);
  // isosurface -> scalar in [0,1]; the smoothstep band is what the dither hatches.
  float v=smoothstep(0.95,1.42,F);
  float th=dither8(frag/u_px);
  float ink=step(th,v)*step(0.02,v);   // kill stray specks where bayer th==0 on empty ground
  ink=mix(ink,1.0-ink,u_inv);
  gl_FragColor=vec4(vec3(1.0-ink),1.0);
}`;

    get maxDPR() { return 1.75; } // 1/d² metaballs are fill-rate bound — clamp DPR below the base 2
    get pointerHome() { return [0.5, 1.8]; } // idle: attractor parked off the top edge
    get wantsFrames() { return this._active || this._energy > 0; }

    onInit() {
      this._clock = 6.0; // fixed resting composition; advances only while active
      this._energy = 0;
    }
    step(dt) {
      energyStep(this, dt, 0.10, 0.05); // bloom fast, ease out gently
      this._clock += 0.6 * dt;          // ~0.6/s drift while interacting or easing out
    }
    time() { return this._clock; }
  }

  // ── <card-field> — cursor-reactive "ink clearing" for ink cards ─────────────
  // Pure ink at rest; a faint white ordered-dither halo blooms ONLY around the pointer
  // and clears when it leaves. u_e gates the ENTIRE effect: u_e==0 -> pure ink.
  class CardField extends Field1Bit {
    static UNIFORMS = ['u_res', 'u_t', 'u_p', 'u_inv', 'u_px', 'u_e'];
    static FRAG = `
uniform vec2 u_res;uniform float u_t;uniform vec2 u_p;uniform float u_inv;uniform float u_px;uniform float u_e;
void main(){
  vec2 frag=gl_FragCoord.xy;
  vec2 uv=frag/u_res;
  float asp=u_res.x/u_res.y;
  vec2 p=vec2(uv.x*asp,uv.y);
  vec2 m=vec2(u_p.x*asp,u_p.y);
  float d=distance(p,m);
  float R=0.44;
  float reveal=1.0-smoothstep(0.0,R,d);
  reveal*=reveal;
  float t=u_t*0.12;
  float grain=fbm(p*3.2+m*1.7+vec2(t*u_e,-t*u_e));
  reveal*=0.45+0.75*grain;
  float v=clamp(reveal*u_e*0.30,0.0,1.0);
  float th=dither8(frag/u_px);
  float mark=step(th,v)*step(0.02,v);   // 1 -> white speck on the ink card
  mark=mix(mark,1.0-mark,u_inv);
  gl_FragColor=vec4(vec3(mark),1.0);
}`;

    // Halo shrinks IN PLACE on leave: home = wherever the cursor currently is.
    get pointerHome() { return this.pointer ? this.pointer.slice() : [0.5, 0.5]; }
    get wantsFrames() { return this._active || this._energy > 0; }

    onInit() { this._energy = 0; this._clock = 0; }
    step(dt) { energyStep(this, dt, 0.14, 0.05); this._clock += dt; }
    time() { return this._clock; }
    extraUniforms(gl, u) { gl.uniform1f(u.u_e, this._energy || 0); }
  }

  customElements.define('dither-field', DitherField);
  customElements.define('metaball-field', MetaballField);
  customElements.define('card-field', CardField);
})();
