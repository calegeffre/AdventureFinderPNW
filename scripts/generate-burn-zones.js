'use strict';

const fs = require('fs');
const path = require('path');

const outDir = path.join(__dirname, '..', 'data', 'burn-zones');
const outFile = path.join(outDir, 'latest.geojson');

const featureCollection = {
  type: 'FeatureCollection',
  generated_at: new Date().toISOString(),
  source: 'github-actions-placeholder',
  notes: 'Replace this placeholder generator with real scene fetch + OlmoEarth inference.',
  features: [
    {
      type: 'Feature',
      properties: {
        id: 'sample-burn-zone-leavenworth',
        name: 'Sample burn zone near Leavenworth',
        severity: 'moderate',
        score: 0.81,
        observed_at: new Date().toISOString()
      },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [-120.742, 47.629],
            [-120.704, 47.629],
            [-120.704, 47.603],
            [-120.742, 47.603],
            [-120.742, 47.629]
          ]
        ]
      }
    }
  ]
};

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(featureCollection, null, 2) + '\n');
console.log(`Burn zones written to ${outFile}`);
