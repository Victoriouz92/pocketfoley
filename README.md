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

## Development

```bash
npm install
npm run dev      # dev server on http://localhost:5173
npm run build    # production build in dist/
npm run preview  # serve the production build on http://localhost:4173
```

Every push to `main` is built and published to GitHub Pages by `.github/workflows/deploy.yml`.

© VV Labs. All rights reserved.
