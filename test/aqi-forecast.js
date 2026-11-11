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
