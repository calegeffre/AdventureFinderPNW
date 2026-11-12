'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { version } = require('maplibre-gl/package.json');

async function routeMapLibreAssets(page) {
  await page.route(`https://unpkg.com/maplibre-gl@${version}/dist/*`, route => {
    const filename = path.basename(new URL(route.request().url()).pathname);
    return route.fulfill({
      status: 200,
      contentType: filename.endsWith('.css') ? 'text/css' : 'application/javascript',
      headers: { 'access-control-allow-origin': '*' },
      body: fs.readFileSync(require.resolve(`maplibre-gl/dist/${filename}`))
    });
  });
}

module.exports = { routeMapLibreAssets };
