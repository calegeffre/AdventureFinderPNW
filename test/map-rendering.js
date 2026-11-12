'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { routeMapLibreAssets } = require('./maplibre-assets');
const { version } = require('maplibre-gl/package.json');

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || chromium.executablePath()
  });
  try {
    for (const filename of ['sunshine.html', 'waves.html', 'trails.html']) {
      const page = await browser.newPage();
      try {
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.route('**/*', route => route.fulfill({ status: 200, body: '' }));
        await page.route('https://unpkg.com/lucide@*/dist/umd/lucide.min.js', route => route.fulfill({
          contentType: 'application/javascript', body: 'window.lucide = { createIcons() {} };'
        }));
        await routeMapLibreAssets(page);
        await page.route(`http://127.0.0.1:8000/${filename}`, route => {
          const html = fs.readFileSync(path.join(__dirname, '..', filename), 'utf8');
          assert.ok(html.includes(`maplibre-gl@${version}/dist/maplibre-gl.mjs`));
          assert.ok(html.includes('const map = new maplibregl.Map('));
          return route.fulfill({
            contentType: 'text/html',
            body: html.replace('const map = new maplibregl.Map(',
              'const map = window.testMap = new maplibregl.Map(')
              .replace("map.addControl(new maplibregl.NavigationControl()",
                "map.on('error', event => { throw event.error; });\n    map.addControl(new maplibregl.NavigationControl()")
          });
        });
        await page.route('https://tiles.openfreemap.org/styles/liberty', route => route.fulfill({
          json: {
            version: 8,
            glyphs: 'http://127.0.0.1:8000/glyphs/{fontstack}/{range}.pbf',
            sources: {},
            layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#eef3f6' } }]
          }
        }));
        await page.route('https://tiles.mapterhorn.com/tilejson.json', route => route.fulfill({
          json: { tilejson: '3.0.0', tiles: ['http://127.0.0.1:8000/terrain/{z}/{x}/{y}.png'], maxzoom: 14 }
        }));
        await page.route('**/v1/**', route => {
          const days = Number(new URL(route.request().url()).searchParams.get('forecast_days'));
          const time = Array.from({ length: days }, (_, index) =>
            `2026-11-${String(11 + index).padStart(2, '0')}`);
          return route.fulfill({
            json: {
              daily: {
                time,
                weather_code: Array(days).fill(0),
                temperature_2m_max: Array(days).fill(60),
                temperature_2m_min: Array(days).fill(40),
                sunshine_duration: Array(days).fill(18000),
                sunrise: time.map(date => `${date}T07:00`),
                sunset: time.map(date => `${date}T17:00`),
                wave_height_max: Array(days).fill(2),
                wave_period_max: Array(days).fill(12),
                wave_direction_dominant: Array(days).fill(270)
              },
              hourly: { us_aqi: Array(168).fill(42) },
              current: { temperature_2m: 50 }
            }
          });
        });
        await page.route('**/datagetter?**', route => route.fulfill({ json: { predictions: [] } }));
        await page.route('**/latest.geojson', route => route.fulfill({
          json: {
            type: 'FeatureCollection',
            features: [{
              type: 'Feature',
              properties: { name: 'Test burn zone', severity: 'moderate' },
              geometry: { type: 'Polygon', coordinates: [[[-121, 47], [-120.9, 47], [-120.9, 47.1], [-121, 47]]] }
            }]
          }
        }));
        const terrainPng = await page.evaluate(() => {
          const canvas = document.createElement('canvas');
          canvas.width = canvas.height = 512;
          const context = canvas.getContext('2d');
          context.fillStyle = 'rgb(128, 0, 0)';
          context.fillRect(0, 0, 512, 512);
          return canvas.toDataURL().split(',')[1];
        });
        await page.route('**/terrain/**/*.png', route => route.fulfill({
          contentType: 'image/png', body: Buffer.from(terrainPng, 'base64')
        }));
        await page.goto(`http://127.0.0.1:8000/${filename}`);
        await page.waitForFunction(() => window.testMap?.loaded());
        assert.equal(await page.evaluate(() => Boolean(window.testMap.getCanvas().getContext('webgl2'))), true);

        if (filename === 'trails.html') {
          assert.equal(await page.evaluate(() => window.testMap.getTerrain().source), 'terrain-rgb');
          assert.ok(await page.evaluate(() => window.testMap.getLayer('trail-pins')));
          await page.click('[data-diff="easy"]');
          assert.ok(await page.evaluate(() => window.testMap.getFilter('trail-pins')));
        } else {
          await page.waitForFunction(() => document.querySelectorAll('.maplibregl-marker').length > 0);
          const markerCount = await page.locator('.maplibregl-marker').count();
          await page.locator('.maplibregl-marker').first().click({ force: true });
          await page.waitForSelector('.maplibregl-popup-content');
          await page.click('#satTab');
          assert.equal(await page.locator('.maplibregl-marker').count(), markerCount);
          if (filename === 'sunshine.html') {
            await page.check('#toggleBurnZones');
            await page.waitForFunction(() => Boolean(window.testMap.getLayer('burn-zone-fill')));
          }
        }
        assert.deepEqual(errors, [], `${filename} must render without runtime/map errors`);
        console.log(`PASS: ${filename} renders with MapLibre ${version}`);
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
