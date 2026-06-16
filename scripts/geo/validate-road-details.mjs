#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const datasetPath = resolve(process.argv[2] ?? 'public/data/road-details/sample-road-details.geojson');

const allowedFeatureTypes = new Set([
    'road_centerline',
    'road_lane',
    'lane_marking',
    'bus_lane',
    'crosswalk',
    'stop_line',
    'traffic_calming',
    'traffic_island',
    'parking_lane',
    'road_edge',
    'turn_arrow',
    'gore_area',
]);

const idFieldsByType = {
    road_centerline: 'road_id',
    road_lane: 'lane_id',
    lane_marking: 'marking_id',
    bus_lane: 'lane_id',
    crosswalk: 'crosswalk_id',
    stop_line: 'stop_line_id',
    traffic_calming: 'traffic_calming_id',
    traffic_island: 'island_id',
    parking_lane: 'parking_id',
    road_edge: 'edge_id',
    turn_arrow: 'arrow_id',
    gore_area: 'gore_id',
};

const roadScopedTypes = new Set([
    'road_centerline',
    'road_lane',
    'lane_marking',
    'bus_lane',
    'stop_line',
    'parking_lane',
    'road_edge',
    'turn_arrow',
    'gore_area',
]);

const requiredByType = {
    road_lane: ['lane_id', 'lane_index', 'direction', 'lane_type'],
    lane_marking: ['marking_id', 'marking_type'],
    bus_lane: ['lane_id', 'direction'],
    crosswalk: ['crosswalk_id', 'crossing_type'],
    stop_line: ['stop_line_id'],
    traffic_calming: ['traffic_calming_id', 'calming_type'],
    traffic_island: ['island_id', 'island_type'],
    parking_lane: ['parking_id', 'parking_type'],
    road_edge: ['edge_id', 'edge_type'],
    turn_arrow: ['arrow_id', 'turn'],
    gore_area: ['gore_id', 'gore_type'],
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

    if (roadScopedTypes.has(featureType) && !properties.road_id) {
        errors.push(`${where}: ${featureType} requires road_id`);
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

console.log(`Road detail dataset is valid: ${payload.features.length} features in ${datasetPath}`);

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
