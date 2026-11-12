'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'sunshine.html'), 'utf8');
const aqiConstant = html.match(/^\s*const AQI_FORECAST_DAYS = \d+;/m);
assert.ok(aqiConstant, 'Missing AQI_FORECAST_DAYS');
const functions = ['calculateForecastDays', 'fetchWeatherForCity', 'updateAqiNotice', 'getAqiForDay'].map(name => {
  const match = html.match(new RegExp(`    (?:async )?function ${name}\\([^]*?^    \\}`, 'm'));
  assert.ok(match, `Missing ${name}`);
  return match[0];
}).join('\n');

const wavesHtml = fs.readFileSync(path.join(__dirname, '..', 'waves.html'), 'utf8');
const waveFunction = wavesHtml.match(/    async function fetchWaveForecast\([^]*?^    \}/m);
assert.ok(waveFunction, 'Missing fetchWaveForecast');

for (const [timezone, instant] of [
  ['America/New_York', '2026-11-12T05:30:00Z'],
  ['Asia/Tokyo', '2026-11-11T16:30:00Z']
]) {
  for (const hostname of ['api.open-meteo.com', 'air-quality-api.open-meteo.com', 'marine-api.open-meteo.com']) {
    test(`${hostname} uses the browser timezone ${timezone} when its date differs from Pacific`, async () => {
      const previousTimezone = process.env.TZ;
      process.env.TZ = timezone;
      try {
        const requests = [];
        const now = new Date(instant);
        const browserTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        assert.equal(browserTimezone, timezone, 'Test must simulate the requested browser timezone');
        const localDate = now.toLocaleDateString('en-CA');
        assert.equal(localDate, '2026-11-12');
        assert.equal(now.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' }), '2026-11-11');

        const context = vm.createContext({
          Intl,
          URLSearchParams,
          Date: class extends Date {
            constructor(...args) {
              super(...(args.length ? args : [instant]));
            }
          },
          console,
          fetch: async url => {
            const request = new URL(url);
            requests.push(request);
            const date = now.toLocaleDateString('en-CA', {
              timeZone: request.searchParams.get('timezone')
            });
            return {
              ok: true,
              json: async () => ({
                daily: { time: [date] },
                hourly: { time: [`${date}T00:00`], us_aqi: [42] },
                current: { temperature_2m: 50 }
              })
            };
          }
        });
        vm.runInContext(`${aqiConstant[0]}\n${functions}\n${waveFunction[0]}`, context);
        await vm.runInContext(
          hostname === 'marine-api.open-meteo.com'
            ? 'fetchWaveForecast({ name: "Westport", lat: 46.9045, lon: -124.1051 }, calculateForecastDays().forecastDaysNeeded)'
            : 'fetchWeatherForCity({ name: "Seattle", lat: 47.6062, lon: -122.3321 }, calculateForecastDays().forecastDaysNeeded)',
          context
        );
        const request = requests.find(url => url.hostname === hostname);
        assert.ok(request, 'Expected forecast request must be made');
        const requestTimezone = request.searchParams.get('timezone');
        assert.ok(request.href.includes(`timezone=${encodeURIComponent(browserTimezone)}&`),
          'Browser timezone must be URL-encoded');
        assert.deepEqual({
          timezone: requestTimezone,
          forecastStartDate: now.toLocaleDateString('en-CA', { timeZone: requestTimezone })
        }, {
          timezone: browserTimezone,
          forecastStartDate: localDate
        }, 'Forecast timezone and Today must match the browser, not the city timezone');
      } finally {
        if (previousTimezone === undefined) {
          delete process.env.TZ;
        } else {
          process.env.TZ = previousTimezone;
        }
      }
    });
  }
}

for (const [day, dayOfWeek, weatherDays] of [['Sunday', 0, 8], ['Saturday', 6, 9]]) {
  test(`${day}: AQI stays within 7 days while weather covers ${weatherDays}`, async () => {
    const requests = [];
    const context = vm.createContext({
      Date: class extends Date { getDay() { return dayOfWeek; } },
      console,
      fetch: async url => {
        requests.push(new URL(url));
        return {
          ok: true,
          json: async () => ({ daily: {}, hourly: { us_aqi: [] }, current: { temperature_2m: 50 } })
        };
      }
    });
    vm.runInContext(`${aqiConstant[0]}\n${functions}`, context);
    await vm.runInContext(
      'fetchWeatherForCity({ name: "Test city", lat: 47.6, lon: -122.3 }, calculateForecastDays().forecastDaysNeeded)',
      context
    );
    const weather = requests.find(url => url.hostname === 'api.open-meteo.com');
    const aqi = requests.find(url => url.hostname === 'air-quality-api.open-meteo.com');
    assert.ok(weather, 'Weather request must be made');
    assert.ok(aqi, 'AQI request must be made');
    assert.ok(weather.searchParams.get('daily').split(',').includes('sunrise'));
    assert.ok(weather.searchParams.get('daily').split(',').includes('sunset'));
    assert.equal(Number(weather.searchParams.get('forecast_days')), weatherDays);
    const aqiDays = Number(aqi.searchParams.get('forecast_days'));
    assert.ok(Number.isInteger(aqiDays) && aqiDays >= 1 && aqiDays <= 7,
      `AQI forecast_days must be 1-7; received ${aqiDays}`);
  });
}

test('AQI notice follows the checkbox and seven-day boundary', () => {
  const notice = { hidden: true };
  const context = vm.createContext({
    document: { getElementById: () => notice },
    allCityData: [],
    showAqi: false
  });
  vm.runInContext(`${aqiConstant[0]}\n${functions}`, context);
  vm.runInContext('updateAqiNotice(7)', context);
  assert.equal(notice.hidden, true);
  vm.runInContext('showAqi = true; updateAqiNotice(7)', context);
  assert.equal(notice.hidden, false);
  assert.equal(notice.textContent, 'No data');
  vm.runInContext('updateAqiNotice(6)', context);
  assert.equal(notice.hidden, true);
  vm.runInContext('updateAqiNotice(8)', context);
  assert.equal(notice.hidden, false);
  vm.runInContext('showAqi = false; updateAqiNotice(8)', context);
  assert.equal(notice.hidden, true);
  assert.equal(vm.runInContext('getAqiForDay({ aqiHourly: Array(216).fill(42) }, 7)', context), null);
  vm.runInContext('showAqi = true; allCityData = [{ aqiHourly: Array(144).fill(42).concat(Array(24).fill(null)) }]; updateAqiNotice(6)', context);
  assert.equal(notice.hidden, false);
  assert.equal(notice.textContent, 'No data');
  vm.runInContext('updateAqiNotice(5)', context);
  assert.equal(notice.hidden, true);
});
