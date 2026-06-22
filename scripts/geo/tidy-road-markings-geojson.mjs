#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const inputPath = resolve(process.argv[2] ?? 'public/data/road-markings/road-markings.geojson');
const outputPath = resolve(process.argv[3] ?? inputPath);

const collection = JSON.parse(readFileSync(inputPath, 'utf8'));
const features = Array.isArray(collection.features) ? collection.features : [];
const wasTidied = Boolean(collection.tidied_at);
const nextFeatures = [];
const crosswalks = [];
const stopLines = new Set();
const yellowBoxes = new Map();

for (const feature of features) {
    const featureType = feature.properties?.feature_type;

    if (featureType === 'yellow_box_line') {
        const nodeId = getYellowBoxNodeId(feature.id);

        if (nodeId) {
            if (!yellowBoxes.has(nodeId)) {
                yellowBoxes.set(nodeId, []);
            }

            yellowBoxes.get(nodeId).push(feature);
        }

        continue;
    }

    if (featureType === 'crosswalk') {
        if (shouldKeepCrosswalk(feature, crosswalks)) {
            if (!wasTidied) {
                trimLineFeature(feature, 0.88);
            }

            crosswalks.push(feature);
            nextFeatures.push(feature);
        }

        continue;
    }

    if (featureType === 'stop_line') {
        const key = getLineClusterKey(feature, 16);

        if (!key || stopLines.has(key)) {
            continue;
        }

        stopLines.add(key);
        if (!wasTidied) {
            trimLineFeature(feature, 0.86);
        }

        nextFeatures.push(feature);
        continue;
    }

    nextFeatures.push(feature);
}

for (const [nodeId, boxFeatures] of yellowBoxes) {
    nextFeatures.push(...buildCompactYellowBox(nodeId, boxFeatures));
}

collection.features = nextFeatures;
collection.tidied_at = new Date().toISOString();
writeFileSync(outputPath, `${JSON.stringify(collection)}\n`);

console.log(`Tidied road markings: ${features.length} -> ${nextFeatures.length} features`);

function shouldKeepCrosswalk(feature, existing) {
    const key = getLineClusterKey(feature, 18);

    if (!key) {
        return false;
    }

    return !existing.some((candidate) => {
        const centerDistance = distanceMeters(getLineCenter(feature), getLineCenter(candidate));
        const angleDistance = undirectedAngleDeltaDegrees(getLineBearing(feature), getLineBearing(candidate));

        return centerDistance <= 18 && angleDistance <= 24;
    });
}

function buildCompactYellowBox(nodeId, boxFeatures) {
    const lineCenters = boxFeatures.map(getLineCenter).filter(Boolean);
    const center = averageCoordinate(lineCenters);

    if (!center) {
        return [];
    }

    const dominantBearing = getDominantLineBearing(boxFeatures);
    const output = [];
    const acrossLimit = 4.4;
    const alongLimit = 3.8;
    const acrossSpacing = acrossLimit * 2;
    const alongSpacing = alongLimit * 2;
    const dashAcross = 1.35;
    const dashAlong = 2.2;
    let lineIndex = 0;

    for (let along = -alongLimit; along <= alongLimit; along += alongSpacing) {
        for (let across = -acrossLimit; across <= acrossLimit; across += acrossSpacing) {
            const dashCenter = offsetFromBearingAxes(center, dominantBearing, across, along);

            for (const direction of [-1, 1]) {
                output.push({
                    type: 'Feature',
                    id: `yellow_box/${nodeId}/tidy_${lineIndex}`,
                    properties: {
                        feature_type: 'yellow_box_line',
                        box_line_id: `box_${nodeId}_tidy_${lineIndex}`,
                    },
                    geometry: {
                        type: 'LineString',
                        coordinates: [
                            roundCoordinatePair(offsetFromBearingAxes(dashCenter, dominantBearing, -dashAcross, -dashAlong * direction)),
                            roundCoordinatePair(offsetFromBearingAxes(dashCenter, dominantBearing, dashAcross, dashAlong * direction)),
                        ],
                    },
                });
                lineIndex += 1;
            }
        }
    }

    return output;
}

function trimLineFeature(feature, factor) {
    const coordinates = feature.geometry?.coordinates;

    if (!Array.isArray(coordinates) || coordinates.length < 2) {
        return;
    }

    const start = coordinates[0];
    const finish = coordinates[coordinates.length - 1];
    const center = getLineCenter(feature);
    const bearing = getLineBearing(feature);
    const halfLength = distanceMeters(start, finish) * factor / 2;

    feature.geometry.coordinates = [
        roundCoordinatePair(offsetCoordinate(center, bearing + 180, halfLength)),
        roundCoordinatePair(offsetCoordinate(center, bearing, halfLength)),
    ];
}

function getYellowBoxNodeId(id) {
    const match = String(id ?? '').match(/^yellow_box\/([^/]+)\//);

    return match?.[1] ?? '';
}

function getDominantLineBearing(features) {
    const bearings = features
        .map(getLineBearing)
        .filter((bearing) => Number.isFinite(bearing))
        .sort((left, right) => left - right);

    return bearings.length ? bearings[Math.floor(bearings.length / 2)] : 0;
}

function averageCoordinate(coordinates) {
    const valid = coordinates.filter((coordinate) => Array.isArray(coordinate));

    if (!valid.length) {
        return null;
    }

    return [
        valid.reduce((sum, coordinate) => sum + coordinate[0], 0) / valid.length,
        valid.reduce((sum, coordinate) => sum + coordinate[1], 0) / valid.length,
    ];
}

function getLineClusterKey(feature, meters) {
    const center = getLineCenter(feature);

    if (!center) {
        return '';
    }

    const grid = Math.max(1, meters);
    const bearingKey = Math.round((getLineBearing(feature) % 180) / 18);

    return `${Math.round(center[0] * 111320 / grid)}:${Math.round(center[1] * 111320 / grid)}:${bearingKey}`;
}

function getLineCenter(feature) {
    const coordinates = feature.geometry?.coordinates;

    if (!Array.isArray(coordinates) || coordinates.length < 2) {
        return null;
    }

    const start = coordinates[0];
    const finish = coordinates[coordinates.length - 1];

    return [
        (start[0] + finish[0]) / 2,
        (start[1] + finish[1]) / 2,
    ];
}

function getLineBearing(feature) {
    const coordinates = feature.geometry?.coordinates;

    if (!Array.isArray(coordinates) || coordinates.length < 2) {
        return 0;
    }

    return getBearing(coordinates[0], coordinates[coordinates.length - 1]);
}

function offsetFromBearingAxes(center, bearing, acrossMeters, alongMeters) {
    const along = offsetCoordinate(center, bearing, alongMeters);

    return offsetCoordinate(along, bearing + 90, acrossMeters);
}

function distanceMeters(start, finish) {
    const earthRadius = 6378137;
    const dLat = toRadians(finish[1] - start[1]);
    const dLon = toRadians(finish[0] - start[0]);
    const lat1 = toRadians(start[1]);
    const lat2 = toRadians(finish[1]);
    const a = Math.sin(dLat / 2) ** 2
        + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;

    return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function offsetCoordinate(coordinate, bearingDegrees, meters) {
    const earthRadius = 6378137;
    const distance = Number(meters) || 0;
    const bearing = toRadians(bearingDegrees);
    const lat1 = toRadians(coordinate[1]);
    const lon1 = toRadians(coordinate[0]);
    const lat2 = Math.asin(
        Math.sin(lat1) * Math.cos(distance / earthRadius)
            + Math.cos(lat1) * Math.sin(distance / earthRadius) * Math.cos(bearing),
    );
    const lon2 = lon1 + Math.atan2(
        Math.sin(bearing) * Math.sin(distance / earthRadius) * Math.cos(lat1),
        Math.cos(distance / earthRadius) - Math.sin(lat1) * Math.sin(lat2),
    );

    return [toDegrees(lon2), toDegrees(lat2)];
}

function getBearing(start, finish) {
    const lon1 = toRadians(start[0]);
    const lat1 = toRadians(start[1]);
    const lon2 = toRadians(finish[0]);
    const lat2 = toRadians(finish[1]);
    const y = Math.sin(lon2 - lon1) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2)
        - Math.sin(lat1) * Math.cos(lat2) * Math.cos(lon2 - lon1);

    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function undirectedAngleDeltaDegrees(left, right) {
    const delta = Math.abs((((left - right) % 180) + 180) % 180);

    return Math.min(delta, 180 - delta);
}

function roundCoordinatePair(coordinate) {
    return [
        Math.round(coordinate[0] * 1000000) / 1000000,
        Math.round(coordinate[1] * 1000000) / 1000000,
    ];
}

function toRadians(value) {
    return Number(value) * Math.PI / 180;
}

function toDegrees(value) {
    return Number(value) * 180 / Math.PI;
}
