'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'sunshine.html'), 'utf8');
const names = ['isPartlySunnyOrBetter', 'getDaylightWeatherCodes', 'hasSufficientSunshine', 'dominantDaylightCode'];
const source = names.map(name => {
  const match = html.match(new RegExp(`    function ${name}\\([^]*?^    \\}`, 'm'));
  assert.ok(match, `Missing ${name}`);
  return match[0];
}).join('\n');
const context = vm.createContext({ console: { warn() {} } });
vm.runInContext(`const SUNNY_MAJORITY_THRESHOLD = 0.5;\n${source}`, context);

function forecast(date, sunrise, sunset, values, dailyCode = 3) {
  return {
    name: 'Seattle',
    dailyData: { time: [date], sunrise: [`${date}T${sunrise}`], sunset: [`${date}T${sunset}`], weather_code: [dailyCode] },
    hourlyData: {
      time: Array.from({ length: 24 }, (_, hour) => `${date}T${String(hour).padStart(2, '0')}:00`),
      weather_code: Array.from({ length: 24 }, (_, hour) => values[hour] ?? 3)
    }
  };
}

test('winter excludes clear hours before sunrise and after sunset', () => {
  const data = forecast('2026-11-14', '07:13', '16:33', { 7: 0, 17: 0, 18: 0, 19: 0 });
  assert.equal(context.hasSufficientSunshine(data, 0), false);
  assert.equal(context.dominantDaylightCode(data, 0), 3);
});

test('summer includes sunny hours after 7pm and before sunset', () => {
  const data = forecast('2026-06-20', '05:11', '21:10',
    Object.fromEntries([6, 7, 8, 9, 10, 11, 19, 20, 21].map(hour => [hour, 0])));
  assert.equal(context.hasSufficientSunshine(data, 0), true);
  assert.equal(context.dominantDaylightCode(data, 0), 0);
});

test('hourly timestamps select the correct day even with missing hours', () => {
  const data = forecast('2026-11-14', '07:13', '16:33', { 8: 0 });
  data.hourlyData.time.unshift('2026-11-13T23:00');
  data.hourlyData.weather_code.unshift(0);
  assert.equal(context.getDaylightWeatherCodes(data, 0).length, 9);
  assert.equal(context.dominantDaylightCode(data, 0), 3);
});

test('missing sunrise or hourly observations falls back to daily weather', () => {
  const data = forecast('2026-11-14', '07:13', '16:33', {}, 61);
  delete data.dailyData.sunrise;
  assert.equal(context.hasSufficientSunshine(data, 0), false);
  assert.equal(context.dominantDaylightCode(data, 0), 61);
});
