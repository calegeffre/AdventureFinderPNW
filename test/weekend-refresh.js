'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

process.env.TZ = 'America/Los_Angeles';

const html = fs.readFileSync(path.join(__dirname, '..', 'sunshine.html'), 'utf8');
const aqiConstant = html.match(/^\s*const AQI_FORECAST_DAYS = \d+;/m);
assert.ok(aqiConstant, 'Missing AQI_FORECAST_DAYS');
const source = ['calculateForecastDays', 'updateTabLabels', 'fetchWeatherForCity', 'updateAllWeather']
  .map(name => {
    const match = html.match(new RegExp(`    (?:async )?function ${name}\\([^]*?^    \\}`, 'm'));
    assert.ok(match, `Missing ${name}`);
    return match[0];
  }).join('\n');
const clickHandlers = html.match(/    \/\/ Tab click handlers\r?\n([^]*?)\r?\n    const firesToggle/);
assert.ok(clickHandlers, 'Missing tab click handlers');

const wavesHtml = fs.readFileSync(path.join(__dirname, '..', 'waves.html'), 'utf8');
const wavesSource = ['calculateForecastDays', 'updateTabLabels', 'fetchWaveForecast', 'updateAllSurf']
  .map(name => {
    const match = wavesHtml.match(new RegExp(`    (?:async )?function ${name}\\([^]*?^    \\}`, 'm'));
    assert.ok(match, `Missing ${name}`);
    return match[0];
  }).join('\n');
const wavesClickHandlers = wavesHtml.match(/    document\.querySelectorAll\('\.tab'\)\.forEach\(\(tab\) => \{[^]*?^    \}\);/m);
assert.ok(wavesClickHandlers, 'Missing wave tab click handlers');

function createPage(initialTime, pageName) {
  const isWaves = pageName === 'waves';
  const forecastHost = isWaves ? 'marine-api.open-meteo.com' : 'api.open-meteo.com';
  let now = initialTime;
  let renderedDate;
  let panelDate;
  const requests = [];
  const tabs = ['0', '1', 'sat', 'sun'].map(day => {
    const classes = new Set(day === '0' ? ['active'] : []);
    return {
      dataset: { day },
      classList: {
        add: name => classes.add(name),
        remove: name => classes.delete(name),
        contains: name => classes.has(name)
      },
      addEventListener(event, handler) {
        assert.equal(event, 'click');
        this.click = handler;
      }
    };
  });
  const elements = {
    todayTab: tabs[0],
    tomorrowTab: tabs[1],
    satTab: tabs[2],
    sunTab: tabs[3],
    loading: { classList: { add() {}, remove() {} } },
    lastUpdated: {},
    bestSurfContent: {}
  };
  const context = vm.createContext({
    Date: class extends Date {
      constructor(...args) {
        super(...(args.length ? args : [now]));
      }
    },
    console,
    URLSearchParams,
    document: {
      getElementById: id => elements[id],
      querySelector: selector => {
        assert.equal(selector, '.tab.active');
        return tabs.find(tab => tab.classList.contains('active'));
      },
      querySelectorAll: selector => {
        assert.equal(selector, '.tab');
        return tabs;
      }
    },
    cities: [{ name: 'Seattle', lat: 47.6062, lon: -122.3321 }],
    surfSpots: [{ name: 'Westport', lat: 46.9045, lon: -124.1051, tideStationId: '9441102' }],
    fetchTidesForStation: async () => ({}),
    fetch: async url => {
      const request = new URL(url);
      requests.push(request);
      let data;
      if (request.hostname === forecastHost) {
        assert.equal(request.searchParams.get('timezone'), 'America/Los_Angeles');
        const days = Number(request.searchParams.get('forecast_days'));
        const start = new Date(now);
        const time = Array.from({ length: days }, (_, index) => {
          const date = new Date(start);
          date.setDate(start.getDate() + index);
          return date.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
        });
        data = {
          daily: {
            time,
            weather_code: Array(days).fill(0),
            temperature_2m_max: Array(days).fill(60),
            temperature_2m_min: Array(days).fill(40)
          },
          current: { temperature_2m: 50 }
        };
      } else {
        assert.equal(request.hostname, 'air-quality-api.open-meteo.com');
        data = { hourly: { us_aqi: Array(7 * 24).fill(42) } };
      }
      return { ok: true, json: async () => data };
    },
    displayWeatherForDay: index => {
      context.selectedDayIndex = index;
      renderedDate = context.allCityData[0].dailyData.time[index];
    },
    updateTop3Panel: index => {
      panelDate = context.allCityData[0].dailyData.time[index];
    },
    displaySurfForDay: index => {
      context.selectedDayIndex = index;
      renderedDate = context.allSpotData[0].waveDaily.time[index];
      panelDate = renderedDate;
    },
    selectedDayIndex: 0,
    showFires: false,
    showBurnZones: false
  });
  vm.runInContext(isWaves
    ? `${wavesSource}\n${wavesClickHandlers[0]}`
    : `${aqiConstant[0]}\n${source}\n${clickHandlers[1]}`, context);

  return {
    context,
    requests,
    elements,
    forecastHost,
    setTime: time => { now = time; },
    refresh: () => vm.runInContext(isWaves ? 'updateAllSurf()' : 'updateAllWeather()', context),
    snapshot(tabId) {
      const tab = elements[tabId];
      return {
        label: tab.textContent,
        buttonIndex: Number(tab.dataset.dayIndex ?? tab.dataset.day),
        selectedIndex: context.selectedDayIndex,
        renderedDate,
        panelDate,
        active: tab.classList.contains('active')
      };
    }
  };
}

function registerTests(pageName) {
  for (const [tabId, dayIndex, beforeDate, afterDate] of [
    ['todayTab', 0, '2026-11-11', '2026-11-12'],
    ['tomorrowTab', 1, '2026-11-12', '2026-11-13']
  ]) {
    test(`${pageName}: ${tabId} preserves its relative day after refresh`, async () => {
      const page = createPage('2026-11-11T23:59:00-08:00', pageName);
      vm.runInContext('updateTabLabels()', page.context);
      await page.refresh();
      page.elements[tabId].click();
      await page.refresh();
      assert.equal(page.snapshot(tabId).renderedDate, beforeDate);

      page.setTime('2026-11-12T00:01:00-08:00');
      await page.refresh();
      const snapshot = page.snapshot(tabId);
      assert.equal(snapshot.selectedIndex, dayIndex);
      assert.equal(snapshot.renderedDate, afterDate);
      assert.equal(snapshot.panelDate, afterDate);
      assert.equal(snapshot.active, true);
    });
  }

  for (const scenario of [
    {
      name: 'Wednesday to Thursday',
      before: '2026-11-11T23:59:00-08:00',
      after: '2026-11-12T00:01:00-08:00',
      beforeDates: ['2026-11-14', '2026-11-15'],
      afterDates: ['2026-11-14', '2026-11-15'],
      beforeIndices: [3, 4],
      afterIndices: [2, 3],
      forecastDays: 4
    },
    {
      name: 'Friday to Saturday (next-weekend boundary)',
      before: '2026-11-13T23:59:00-08:00',
      after: '2026-11-14T00:01:00-08:00',
      beforeDates: ['2026-11-14', '2026-11-15'],
      afterDates: ['2026-11-21', '2026-11-22'],
      beforeIndices: [1, 2],
      afterIndices: [7, 8],
      forecastDays: 9
    }
  ]) {
    for (const [index, tabId, day] of [[0, 'satTab', 'Saturday'], [1, 'sunTab', 'Sunday']]) {
      test(`${pageName}: ${day} stays aligned after midnight refresh: ${scenario.name}`, async () => {
        const page = createPage(scenario.before, pageName);
        vm.runInContext('updateTabLabels()', page.context);
        await page.refresh();
        page.elements[tabId].click();

        function expected(date, dayIndex) {
          const labelDate = new Date(`${date}T12:00:00-08:00`)
            .toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
          return {
            label: `${day} ${labelDate}`,
            buttonIndex: dayIndex,
            selectedIndex: dayIndex,
            renderedDate: date,
            panelDate: date,
            active: true
          };
        }

        assert.deepEqual(page.snapshot(tabId),
          expected(scenario.beforeDates[index], scenario.beforeIndices[index]),
          'Initial selection must match the labeled weekend date');

        page.setTime(scenario.after);
        await page.refresh();

        const weatherRequests = page.requests.filter(url => url.hostname === page.forecastHost);
        assert.equal(weatherRequests.length, 2, 'Refresh must fetch new weather');
        assert.equal(Number(weatherRequests[1].searchParams.get('forecast_days')), scenario.forecastDays);
        assert.deepEqual(page.snapshot(tabId),
          expected(scenario.afterDates[index], scenario.afterIndices[index]),
          'Refresh must keep the weekend label, button index, map, and results panel aligned');
      });
    }
  }
}

registerTests('sunshine');
registerTests('waves');
