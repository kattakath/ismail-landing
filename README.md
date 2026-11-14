# ismail.kattakath.com

Static professional landing page, served by GitHub Pages. **This repo is the source of
truth.** (It once lived in nix-config `sites/ismail-landing/`; nix-config deleted that copy
on 2026-10-21.)

No build step: the files here are the site.

| Path | What it is |
| --- | --- |
| `index.html` | the landing page |
| `case-studies/detracing/` | the de-tracing case study |
| `404.html` | served by Pages for any missing path |
| `vendor/duochrome-1.1.0.css` | the Duochrome design system, vendored verbatim |
| `styles.css` | fonts and page components only, loaded after the design system |
| `site.js`, `dither-1bit.js` | progressive enhancement; the page reads fine without them |
| `sitemap.xml`, `robots.txt`, `llms.txt` | crawler files; `sitemap.xml` `lastmod` is hand-maintained |

## The design-system pin

`vendor/duochrome-1.1.0.css` is a byte-exact copy of `duochrome.css` at tag `v1.1.0` of
the private `ismailkattakath/design-system` repo. Page-specific rules never go in it.
`vendor/duochrome.sha256` records its checksum, and CI fails if the two disagree.

To bump: copy the new tag's `duochrome.css` to `vendor/duochrome-<version>.css`, update
the `<link>` on every page, and rewrite `vendor/duochrome.sha256` with `sha256sum`.

## Cache busting

Every page loads its CSS and JS with the same `?v=YYYYMMDDx` token. Bump it on all
pages together whenever a stylesheet or script changes.

## CI

One required check, `gate` (the shared `kattakath/.github` gate action), over these jobs:

| Job | Checks |
| --- | --- |
| `gitleaks` | no secrets anywhere in history |
| `links` | `lychee --offline`: every local link, asset and `#fragment` in `**/*.html` resolves |
| `svg` | every `*.svg` is well-formed XML (`xmllint`) and at least 100 bytes |
| `design-system` | the vendored file carries its version header and matches `vendor/duochrome.sha256` |
