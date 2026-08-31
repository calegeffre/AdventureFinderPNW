# AdventureFinder PNW ☀️⛷️🏄‍♂️

"Where can I find sun this weekend?", "Where's the best waves?", "I can ski or hike on Saturday, where should I go?"

- Find the sun, waves, snow, or trails with interactive maps for the Pacific Northwest — live weather forecasts, wave and snow reports, and a 3D trail explorer for today, tomorrow, and the upcoming weekend.

![SunshineFinder preview](https://github.com/user-attachments/assets/c00c158b-fa70-4fde-8f2b-9954866e29cc)

## What it does

- 🗺️ Displays 18+ cities across Washington, Oregon, Idaho, and British Columbia on an interactive map
- ☀️ Fetches live weather from the [Open-Meteo API](https://open-meteo.com/) and shows current conditions with emoji indicators
- 📅 Lets you browse a 4-day forecast (Today, Tomorrow, and the next two days) via day tabs
- 🎯 Ranks the nearest sunny cities and surfaces the **Top 3 Closest Sunny Spots** panel
- 🔥 Can display active fires and repo-backed burn-zone polygons on the sunshine map
- 🥾 **Trail Finder** — an interactive 3D map of 20+ Washington hikes with real USGS elevation terrain
- 🔄 Auto-refreshes every 15 minutes so the data stays current

## Design system

The site's styling is driven by a small **Tailwind CSS v4** design system with a **national-park poster** aesthetic — warm "paper" tones, bold condensed [Oswald](https://fonts.google.com/specimen/Oswald) headings, and retro flat cards — so the three pages (Sunshine, Powder, Waves) stay visually consistent from a single source of truth.

- **Tokens** live in [`src/app.css`](src/app.css) as Tailwind `@theme` variables — colors, typography, and motion.
- **Per-page theming**: all pages share one paper canvas; set `data-theme="sun" | "powder" | "waves"` on `<body>` to swap the signature accent (rust-gold / glacier / lake-teal). The top rule, labels, links, and active tabs re-color automatically.
- **Components** (tabs, frosted panels, collapsible bodies, loading spinner, header/footer) are defined once in the `@layer components` block and reused across pages.
- **Living reference**: open [`styleguide.html`](styleguide.html) in a browser to browse the tokens and components.

### Building the CSS

The compiled stylesheet is committed at `dist/adventurefinder.css`. Rebuild it after editing tokens or components:

```bash
npm install          # first time only
npm run build:css    # one-off minified build
npm run watch:css    # rebuild on change while developing
```

## Open source libraries

SunshineFinder is built on top of these great open source projects:

| Library | Version | What we use it for |
|---|---|---|
| [Leaflet](https://leafletjs.com/) | 1.9.4 | Interactive map rendering and city markers (Sunshine, Snow, Waves pages) |
| [MapLibre GL JS](https://maplibre.org/) | 4.7.1 | 3D WebGL map rendering with terrain elevation on the Trail Finder |
| [Open-Meteo API](https://open-meteo.com/) | — | Free, no-auth weather forecast data (WMO weather codes, temperature) |
| [CARTO](https://carto.com/) / [OpenStreetMap](https://www.openstreetmap.org/) | — | Dark basemap tiles displayed inside the Leaflet map |
| [OpenFreeMap](https://openfreemap.org/) | — | Vector map tiles powering the Trail Finder basemap (OpenStreetMap data, no API key) |
| [Mapterhorn](https://mapterhorn.com/) | — | CORS-enabled Terrarium elevation tiles used for 3D terrain and hillshading on the Trail Finder |
| [Tailwind CSS](https://tailwindcss.com/) | ^4.3 | Design-system tokens + compiled stylesheet (`dist/adventurefinder.css`) |
| [Playwright](https://playwright.dev/) | ^1.58.2 | Headless browser automation used to generate the screenshot above |

## Burn zones pipeline

Burn zones are now wired as a **repo-backed GeoJSON layer** loaded from `data/burn-zones/latest.geojson`.

- The Sunshine map can toggle **Show burn zones** and render polygons with severity/confidence metadata.
- A scheduled GitHub Actions workflow at `.github/workflows/burn-zones.yml` regenerates that GeoJSON and commits it back into the repository.
- The current generator in `scripts/generate-burn-zones.js` is a placeholder scaffold intended to be replaced by a real satellite-scene + OlmoEarth inference pipeline.

This repo storage approach is the simplest place to start because it keeps deployment static: GitHub Pages can serve the generated GeoJSON directly with no separate database or API.

## Generating screenshots with Playwright

The `screenshots/preview.png` image in this README is produced automatically by `test/screenshot.js` using [Playwright](https://playwright.dev/).

**How it works:**

1. Playwright launches a headless Chromium browser and loads `index.html`.
2. All external network requests are intercepted and replaced with deterministic mock data so the screenshot is fast and reproducible:
   - The Leaflet CDN (JS + CSS) is served from locally vendored copies in `test/vendor/`.
   - CartoDB map tiles are replaced with a 1×1 dark-grey PNG placeholder so tiles render instantly without network calls.
   - Open-Meteo API calls return hardcoded weather codes, making specific cities appear sunny or rainy in a predictable way.
3. The script waits until the **Top 3 Closest Sunny Spots** panel is fully populated, then captures a 1280×800 viewport screenshot.

**Regenerate the screenshot at any time:**

```bash
npm run screenshot
```

## Security review

A security advisory check was performed against the [GitHub Advisory Database](https://github.com/advisories) for all direct dependencies:

| Package | Version | Vulnerabilities found |
|---|---|---|
| `playwright` | ^1.58.2 | ✅ None |
| `leaflet` (vendored) | 1.9.4 | ✅ None |

**Additional notes:**

- **Open-Meteo API** — requests are read-only `GET` calls to a public, unauthenticated endpoint. No credentials are stored or transmitted.
- **CARTO / OpenStreetMap tiles** — tile URLs are composed of standard `{z}/{x}/{y}` slippy-map coordinates. No user data is sent in tile requests.
- **Leaflet is vendored** (`test/vendor/leaflet.js`) rather than loaded live from a CDN in the test environment, which eliminates supply-chain risk during screenshot generation.
- The app itself is a fully client-side, single HTML file with no backend and no user authentication, which keeps the attack surface minimal.

## License

[MIT](LICENSE)
