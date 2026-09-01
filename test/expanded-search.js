/**
 * expanded-search.js
 *
 * Integration test that validates the "search farther out" behaviour introduced
 * to replace the "No sunny spots found" dead-end.
 *
 * Mock scenario (Today = day index 0):
 *   All 18 main cities → overcast (code 3)  – not in CITY_CODES so they
 *   get the default [3, 3] treatment from buildMockWeather().
 *   All 18 fallback cities → overcast (code 3)  – same reason.
 *   Three expanded cities → sunny:
 *     Victoria BC    (48.4284, -123.3656)  ~74 mi  → code 0 (Clear Sky)
 *     Aberdeen WA    (46.9759, -123.8157)  ~81 mi  → code 1 (Mainly Clear)
 *     Ocean Shores WA (47.0043, -124.1557) ~94 mi  → code 1 (Mainly Clear)
 *
 * Expected result:
 *   Top 3 panel shows those three cities (not "No sunny spots found").
 *
 * Run:  node test/expanded-search.js
 */

'use strict';

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const REPO_ROOT = path.resolve(__dirname, '..');
const INDEX_HTML = path.join(REPO_ROOT, 'sunshine.html');

// ---------------------------------------------------------------------------
// Mock weather data
// Only the three expanded cities are listed here; every other city will
// receive the default [3, 3] (overcast) codes.
// ---------------------------------------------------------------------------
const CITY_CODES = {
  '48.4284:-123.3656': [0, 0],   // Victoria BC  – clear sky
  '46.9759:-123.8157': [1, 0],   // Aberdeen WA  – mainly clear
  '47.0043:-124.1557': [1, 0],   // Ocean Shores WA – mainly clear
};

function latLonKey(url) {
  const lat = parseFloat(new URL(url).searchParams.get('latitude'));
  const lon = parseFloat(new URL(url).searchParams.get('longitude'));
  const exact = `${lat}:${lon}`;
  if (CITY_CODES[exact]) return exact;
  const r4 = `${parseFloat(lat.toFixed(4))}:${parseFloat(lon.toFixed(4))}`;
  return r4;
}

function buildMockWeather(url) {
  const key = latLonKey(url);
  const [code0 = 3, code1 = 3] = CITY_CODES[key] || [];
  const forecastDays = parseInt(new URL(url).searchParams.get('forecast_days') || '2');

  const dates = [];
  const weatherCodes = [];
  const maxTemps = [];
  const minTemps = [];
  const hourlyTimes = [];
  const hourlyCodes = [];
  const base = new Date('2026-03-28');

  for (let i = 0; i < forecastDays; i++) {
    const d = new Date(base);
    d.setDate(base.getDate() + i);
    const dateStr = d.toISOString().slice(0, 10);
    dates.push(dateStr);
    const dayCode = i === 0 ? code0 : code1;
    weatherCodes.push(dayCode);
    maxTemps.push(55);
    minTemps.push(40);

    // Generate 24 hourly entries per day, all matching the daily code
    for (let h = 0; h < 24; h++) {
      hourlyTimes.push(`${dateStr}T${String(h).padStart(2, '0')}:00`);
      hourlyCodes.push(dayCode);
    }
  }

  return {
    latitude: parseFloat(new URL(url).searchParams.get('latitude')),
    longitude: parseFloat(new URL(url).searchParams.get('longitude')),
    generationtime_ms: 0.1,
    utc_offset_seconds: -25200,
    timezone: 'America/Los_Angeles',
    timezone_abbreviation: 'PDT',
    elevation: 50,
    current_units: { time: 'iso8601', interval: 'seconds', temperature_2m: '°F', weather_code: 'wmo code' },
    current: { time: dates[0] + 'T12:00', interval: 900, temperature_2m: 50, weather_code: code0 },
    daily_units: { time: 'iso8601', weather_code: 'wmo code', temperature_2m_max: '°F', temperature_2m_min: '°F' },
    daily: {
      time: dates,
      weather_code: weatherCodes,
      temperature_2m_max: maxTemps,
      temperature_2m_min: minTemps,
    },
    hourly_units: { time: 'iso8601', weather_code: 'wmo code' },
    hourly: {
      time: hourlyTimes,
      weather_code: hourlyCodes,
    },
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
(async () => {
  const maplibreJs = fs.readFileSync(require.resolve('maplibre-gl/dist/maplibre-gl.js'), 'utf8');
  const maplibreCss = fs.readFileSync(require.resolve('maplibre-gl/dist/maplibre-gl.css'), 'utf8');

  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium-browser',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  const page = await browser.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });

  await page.route('https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js', route =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: maplibreJs })
  );
  await page.route('https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css', route =>
    route.fulfill({ status: 200, contentType: 'text/css', body: maplibreCss })
  );
  await page.route('https://tiles.openfreemap.org/styles/liberty', route => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        version: 8,
        sources: {},
        layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#eef3f6' } }],
      }),
    });
  });
  await page.route(/api\.open-meteo\.com/, route => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(buildMockWeather(route.request().url())),
    });
  });

  await page.goto('file://' + INDEX_HTML);

  // Wait for the panel to finish searching (no "Loading" or "Searching")
  await page.waitForFunction(() => {
    const el = document.getElementById('top3Content');
    if (!el) return false;
    const text = el.textContent || '';
    return (
      !text.includes('Loading') &&
      !text.includes('Searching') &&
      text.trim().length > 0
    );
  }, { timeout: 60000 });

  const panelText = await page.$eval('#top3Content', el => el.innerText);
  console.log('\nTop 3 panel content:\n' + panelText);

  // Assertions
  let passed = true;

  if (panelText.includes('No sunny spots found')) {
    console.error('FAIL: panel still shows "No sunny spots found" – expanded search did not trigger');
    passed = false;
  } else {
    console.log('PASS: panel does not show "No sunny spots found"');
  }

  const expectedCities = ['Victoria BC', 'Aberdeen WA', 'Ocean Shores WA'];
  for (const city of expectedCities) {
    if (panelText.includes(city)) {
      console.log(`PASS: panel contains "${city}"`);
    } else {
      console.error(`FAIL: panel is missing "${city}"`);
      passed = false;
    }
  }

  await browser.close();

  if (!passed) {
    process.exit(1);
  }
  console.log('\nAll assertions passed.');
})().catch(err => {
  console.error(err);
  process.exit(1);
});
