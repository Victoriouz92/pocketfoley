# PocketFoley

Procedural sound effects studio for creators — 240+ sounds (viral SFX, UI clicks, whooshes, 808s,
drums, instruments), a 3-track pattern maker and 48 kHz WAV export. Every sound is synthesized live
in the browser; there are no sample files.

**Produced by VV Labs.**

**Open the app:** https://victoriouz92.github.io/pocketfoley/

It installs like a regular app and then works offline:

- **iPhone / iPad (Safari):** Share → Add to Home Screen
- **Android (Chrome):** menu → Install app, or the *Install app* button in PocketFoley
- **Windows / Mac (Chrome or Edge):** the install icon in the address bar, or the *Install app* button

## Using your exported sounds

You may use WAV files you create with PocketFoley in personal and commercial
projects, including games, videos, podcasts and streams. Credit to VV Labs is
appreciated but not required. This permission covers exported sounds, not the
PocketFoley application or its source code.

## Development

```bash
npm install
npm run dev      # dev server on http://localhost:5173
npm run build    # production build in dist/
npm run preview  # serve the production build on http://localhost:4173
```

Every push to `main` is built and published to GitHub Pages by `.github/workflows/deploy.yml`.

## SEO and documentation

The canonical deployment is `https://victoriouz92.github.io/pocketfoley/`. Keep the `/pocketfoley/` prefix in canonical, social, structured-data and sitemap URLs. Keep asset, manifest and service-worker paths relative so installs and other distribution folders keep working.

The quick guide in `index.html` is ordinary visible HTML outside React's root. It remains available before and after the studio loads, including when JavaScript is disabled. Update its product statements alongside the studio and README usage terms. The header's Quick guide button scrolls to it without replacing a shared patch/pattern hash.

Run `npm run build` and `npm run check:seo` before publishing. The latter validates the built HTML, sitemap and subpath assets. Set `SEO_TEST_URL=https://victoriouz92.github.io/pocketfoley/` to verify the published files and missing-page status. For a local production preview with the same path, use `npm run preview -- --base /pocketfoley/`.

GitHub Pages reads robots.txt at the origin root, outside this project deployment. A `/pocketfoley/robots.txt` file would not control crawling of this host; submit the sitemap through Search Console when property access is available.

© VV Labs. All rights reserved.
