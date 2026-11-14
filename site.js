/* site.js — progressive enhancement for the Duochrome landing.
   Nothing here is required to read the page: it sets a `.js` flag first, and every
   behaviour degrades to plain, visible, keyboard-reachable content without it.
   Vanilla, no dependencies, reduced-motion-aware. */
(function () {
  "use strict";
  var doc = document;
  var root = doc.documentElement;
  root.classList.add("js");

  var reduce = false;
  try {
    var mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    reduce = mq.matches;
    (mq.addEventListener
      ? mq.addEventListener.bind(mq, "change")
      : mq.addListener.bind(mq))(function (e) { reduce = e.matches; });
  } catch (e) {}

  function ready(fn) {
    if (doc.readyState !== "loading") fn();
    else doc.addEventListener("DOMContentLoaded", fn);
  }

  ready(function () {
    var header = doc.querySelector(".site-header");
    var toggle = doc.querySelector(".nav-toggle");
    var nav = doc.getElementById("primary-nav");

    /* ---- Keep --header-h accurate to the REAL header height (WCAG 2.4.11) ---- */
    function syncHeaderHeight() {
      if (!header) return;
      root.style.setProperty("--header-h", header.offsetHeight + "px");
    }
    syncHeaderHeight();
    window.addEventListener("resize", debounce(syncHeaderHeight, 150));
    window.addEventListener("load", syncHeaderHeight);

    /* ---- Mobile nav disclosure ---- */
    if (toggle && nav && header) {
      toggle.removeAttribute("hidden");

      function isOpen() { return header.hasAttribute("data-nav-open"); }
      function open() {
        header.setAttribute("data-nav-open", "");
        toggle.setAttribute("aria-expanded", "true");
        var first = nav.querySelector("a");
        if (first) first.focus();
        doc.addEventListener("keydown", onKey);
        doc.addEventListener("click", onOutside, true);
      }
      function close(refocus) {
        header.removeAttribute("data-nav-open");
        toggle.setAttribute("aria-expanded", "false");
        doc.removeEventListener("keydown", onKey);
        doc.removeEventListener("click", onOutside, true);
        if (refocus) toggle.focus();
      }
      function onKey(e) {
        if (e.key === "Escape" || e.key === "Esc") { e.preventDefault(); close(true); }
      }
      function onOutside(e) {
        if (!header.contains(e.target)) close(false);
      }

      toggle.addEventListener("click", function () {
        isOpen() ? close(false) : open();
      });
      /* a tap on any nav link dismisses the menu */
      nav.addEventListener("click", function (e) {
        if (e.target.closest("a") && isOpen()) close(false);
      });
      /* returning to desktop width clears the mobile state entirely */
      window.addEventListener("resize", debounce(function () {
        if (window.innerWidth >= 760 && isOpen()) close(false);
      }, 150));
    }

    /* ---- Scroll-spy: mark the in-page section that owns the viewport ---- */
    var spyLinks = {};
    if (nav && "IntersectionObserver" in window) {
      var anchors = nav.querySelectorAll('a[href^="#"], a[href^="/#"]');
      var spyTargets = [];
      Array.prototype.forEach.call(anchors, function (a) {
        var hash = a.getAttribute("href").replace(/^\//, "");
        if (hash.charAt(0) !== "#") return;
        var sec = doc.querySelector(hash);
        if (sec) { spyLinks[sec.id] = a; spyTargets.push(sec); }
      });
      if (spyTargets.length) {
        var spy = new IntersectionObserver(function (entries) {
          entries.forEach(function (en) {
            var a = spyLinks[en.target.id];
            if (!a) return;
            if (en.isIntersecting) {
              for (var id in spyLinks) spyLinks[id].removeAttribute("aria-current");
              a.setAttribute("aria-current", "true");
            }
          });
        }, { rootMargin: "-45% 0px -50% 0px", threshold: 0 });
        spyTargets.forEach(function (s) { spy.observe(s); });
      }
    }

    /* ---- Career timeline: positions and the current role's length, against today ----
       Rows carry data-start / data-end (YYYY-MM); the axis runs from Jan 2010 to now.
       The inline --from/--w/--dur values are the no-JS fallback, computed the same way. */
    var tl = doc.querySelector(".timeline");
    if (tl) {
      var AXIS0 = 2010;
      var monthsOf = function (ym) {
        var p = ym.split("-");
        return (+p[0] - AXIS0) * 12 + (+p[1] - 1);
      };
      var d = new Date();
      var dim = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      var now = (d.getFullYear() - AXIS0) * 12 + d.getMonth() + (d.getDate() - 1) / dim;
      var pct = function (n) { return (Math.round(n * 1000) / 10).toString(); };
      var rows = tl.querySelectorAll(".tl-row[data-start]");
      var spans = [], longest = 0;
      Array.prototype.forEach.call(rows, function (row) {
        var a = monthsOf(row.getAttribute("data-start"));
        var end = row.getAttribute("data-end");
        var b = end ? monthsOf(end) : now;
        spans.push([row, a, b]);
        longest = Math.max(longest, b - a);
      });
      spans.forEach(function (x) {
        var row = x[0], a = x[1], b = x[2];
        row.style.setProperty("--from", pct(a / now));
        row.style.setProperty("--w", pct((b - a) / now));
        row.style.setProperty("--dur", Math.round(((b - a) / longest) * 100));
        var dur = row.querySelector(".tl-dur");
        if (dur) {
          var m = Math.floor(b - a), y = Math.floor(m / 12);
          dur.textContent = y ? y + "y " + (m % 12) + "m" : m + " mo";
        }
      });
      Array.prototype.forEach.call(tl.querySelectorAll(".tl-axis [data-year]"), function (s) {
        s.style.setProperty("--p", pct(((+s.getAttribute("data-year") - AXIS0) * 12) / now));
      });
    }

    /* ---- Reveals: only hide what is BELOW the fold, so nothing flashes ---- */
    if (!reduce && "IntersectionObserver" in window) {
      var sections = doc.querySelectorAll("main > section");
      var revealables = [];
      Array.prototype.forEach.call(sections, function (s, i) {
        var r = s.getBoundingClientRect();
        if (i === 0 || r.top < window.innerHeight * 0.9) return; /* leave above-fold visible */
        s.classList.add("reveal");
        revealables.push(s);
      });
      var tl = doc.querySelector(".timeline");
      if (tl) revealables.push(tl);
      if (revealables.length) {
        var io = new IntersectionObserver(function (entries) {
          entries.forEach(function (en) {
            if (en.isIntersecting) {
              en.target.classList.add("in-view");
              io.unobserve(en.target);
            }
          });
        }, { rootMargin: "0px 0px -12% 0px", threshold: 0.12 });
        revealables.forEach(function (el) { io.observe(el); });
      }
    }
  });

  function debounce(fn, ms) {
    var t;
    return function () {
      var ctx = this, args = arguments;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(ctx, args); }, ms);
    };
  }
})();
