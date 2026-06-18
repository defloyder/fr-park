#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const datasetPath = resolve(process.argv[2] ?? 'public/data/road-markings/road-markings.geojson');

const allowedFeatureTypes = new Set([
    'lane_marking',
    'bus_lane',
    'crosswalk',
    'stop_line',
    'yellow_box_line',
    'hatched_area_line',
    'turn_arrow',
    'road_mask',
    'speed_marking',
    'traffic_signal',
]);

const idFieldsByType = {
    lane_marking: 'marking_id',
    bus_lane: 'lane_id',
    crosswalk: 'crosswalk_id',
    stop_line: 'stop_line_id',
    yellow_box_line: 'box_line_id',
    hatched_area_line: 'area_line_id',
    turn_arrow: 'arrow_id',
    road_mask: 'road_id',
    speed_marking: 'road_id',
    traffic_signal: 'osm_id',
};

const requiredByType = {
    lane_marking: ['road_id', 'marking_id', 'marking_type'],
    bus_lane: ['road_id', 'lane_id', 'direction'],
    crosswalk: ['crosswalk_id'],
    stop_line: ['road_id', 'stop_line_id'],
    yellow_box_line: ['box_line_id'],
    hatched_area_line: ['area_line_id'],
    turn_arrow: ['road_id', 'arrow_id', 'turn'],
    road_mask: ['road_id', 'lanes_total', 'structure_level'],
    speed_marking: ['road_id', 'maxspeed'],
    traffic_signal: ['osm_id'],
};

const errors = [];
let payload;

try {
    payload = JSON.parse(readFileSync(datasetPath, 'utf8'));
} catch (error) {
    fail(`Cannot read GeoJSON: ${error.message}`);
}

if (payload?.type !== 'FeatureCollection' || !Array.isArray(payload.features)) {
    fail('Dataset must be a GeoJSON FeatureCollection.');
}

const idsByType = new Map();

payload.features.forEach((feature, index) => {
    const where = `feature[${index}]`;
    const properties = feature?.properties ?? {};
    const featureType = properties.feature_type;

    if (!featureType) {
        errors.push(`${where}: missing properties.feature_type`);
        return;
    }

    if (!allowedFeatureTypes.has(featureType)) {
        errors.push(`${where}: unknown feature_type "${featureType}"`);
        return;
    }

    if (!hasCoordinates(feature?.geometry)) {
        errors.push(`${where}: geometry is empty or has no coordinates`);
    }

    for (const field of requiredByType[featureType] ?? []) {
        if (properties[field] === undefined || properties[field] === null || properties[field] === '') {
            errors.push(`${where}: ${featureType} requires ${field}`);
        }
    }

    const idField = idFieldsByType[featureType];
    const id = properties[idField];

    if (!id) {
        errors.push(`${where}: ${featureType} requires ${idField}`);
        return;
    }

    if (!idsByType.has(featureType)) {
        idsByType.set(featureType, new Set());
    }

    const ids = idsByType.get(featureType);

    if (ids.has(id)) {
        errors.push(`${where}: duplicate ${idField} "${id}" for ${featureType}`);
    }

    ids.add(id);
});

if (errors.length > 0) {
    fail(errors.join('\n'));
}

console.log(`Road marking dataset is valid: ${payload.features.length} features in ${datasetPath}`);

function hasCoordinates(geometry) {
    if (!geometry || typeof geometry.type !== 'string') {
        return false;
    }

    return countCoordinatePairs(geometry.coordinates) > 0;
}

function countCoordinatePairs(value) {
    if (!Array.isArray(value)) {
        return 0;
    }

    if (value.length >= 2 && Number.isFinite(Number(value[0])) && Number.isFinite(Number(value[1]))) {
        return 1;
    }

    return value.reduce((count, child) => count + countCoordinatePairs(child), 0);
}

function fail(message) {
    console.error(message);
    process.exit(1);
}
