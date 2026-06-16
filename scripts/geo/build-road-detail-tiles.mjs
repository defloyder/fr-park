#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const input = resolve(process.argv[2] ?? 'public/data/road-details/road-details.geojson');
const output = resolve(process.argv[3] ?? 'public/data/road-details/road-details.mbtiles');

if (!existsSync(input)) {
    console.error(`Input GeoJSON was not found: ${input}`);
    process.exit(1);
}

const args = [
    '-o',
    output,
    '-zg',
    '--drop-densest-as-needed',
    '--extend-zooms-if-still-dropping',
    '--force',
    '--layer',
    'road_details',
    input,
];

const command = `tippecanoe ${args.map(quoteShell).join(' ')}`;
console.log(command);

const result = spawnSync('tippecanoe', args, { stdio: 'inherit' });

if (result.error?.code === 'ENOENT') {
    console.log('\nTippecanoe is not installed here. Install it and run the printed command.');
    console.log('Optional PMTiles step: pmtiles convert road-details.mbtiles road-details.pmtiles');
    process.exit(0);
}

process.exit(result.status ?? 1);

function quoteShell(value) {
    return /\s/.test(value) ? `"${value.replaceAll('"', '\\"')}"` : value;
}
