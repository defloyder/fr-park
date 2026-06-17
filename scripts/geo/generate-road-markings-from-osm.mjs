#!/usr/bin/env node

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const DEFAULT_BBOX = '55.48,37.30,55.96,37.96'; // south,west,north,east: Moscow core
const OUTPUT_PATH = resolve(process.argv[3] ?? 'public/data/road-markings/road-markings.geojson');
const bbox = parseBbox(process.argv[2] ?? process.env.ROAD_MARKINGS_BBOX ?? DEFAULT_BBOX);
const chunkCount = clampInt(process.argv[4] ?? process.env.ROAD_MARKINGS_CHUNKS, shouldChunkBbox(bbox) ? 4 : 1, 1, 16);
const requestRetries = clampInt(process.env.OVERPASS_RETRIES, 2, 0, 8);
const requestDelayMs = clampInt(process.env.OVERPASS_DELAY_MS, 1800, 0, 60000);
const requestTimeoutSeconds = clampInt(process.env.OVERPASS_TIMEOUT_SECONDS, 240, 30, 600);

const elementById = new Map();
let endpointCursor = 0;

for (const chunk of makeBboxChunks(bbox, chunkCount)) {
    const payload = await fetchOverpass(buildRoadQuery(chunk));

    for (const element of payload.elements ?? []) {
        elementById.set(`${element.type}/${element.id}`, element);
    }

    if (requestDelayMs > 0) {
        await sleep(requestDelayMs);
    }
}

const features = buildRoadMarkingFeatures([...elementById.values()]);

function buildRoadQuery(targetBbox) {
    return `
[out:json][timeout:${requestTimeoutSeconds}];
(
  way["highway"]["highway"!~"^(footway|path|cycleway|steps|corridor|platform|pedestrian)$"](${targetBbox.join(',')});
);
out tags geom;
`;
}

mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
writeFileSync(OUTPUT_PATH, `${JSON.stringify({
    type: 'FeatureCollection',
    name: 'road-markings',
    generated_at: new Date().toISOString(),
    bbox: {
        south: bbox[0],
        west: bbox[1],
        north: bbox[2],
        east: bbox[3],
    },
    features,
}, null, 2)}\n`);

console.log(`Wrote ${features.length} road marking features to ${OUTPUT_PATH}`);

async function fetchOverpass(overpassQuery) {
    const endpoints = (process.env.OVERPASS_URLS
        ? process.env.OVERPASS_URLS.split(',').map((url) => url.trim()).filter(Boolean)
        : process.env.OVERPASS_URL ? [process.env.OVERPASS_URL] : [
        'https://overpass-api.de/api/interpreter',
        'https://overpass.kumi.systems/api/interpreter',
        'https://overpass.private.coffee/api/interpreter',
    ]);
    const errors = [];

    for (let attempt = 0; attempt <= requestRetries; attempt += 1) {
        const endpoint = endpoints[(endpointCursor + attempt) % endpoints.length];

        try {
            console.log(`Querying ${endpoint} (attempt ${attempt + 1}/${requestRetries + 1}) ...`);
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
                    accept: 'application/json',
                    'user-agent': 'AuralithMapsRoadMarkings/1.0 (local dataset generator)',
                },
                body: new URLSearchParams({ data: overpassQuery }),
                signal: AbortSignal.timeout((requestTimeoutSeconds + 30) * 1000),
            });

            if (!response.ok) {
                const body = await response.text();
                throw new Error(`${endpoint} returned ${response.status}: ${body.slice(0, 300)}`);
            }

            endpointCursor = (endpointCursor + attempt + 1) % endpoints.length;

            return response.json();
        } catch (error) {
            errors.push(error.message);
        }

        if (attempt < requestRetries) {
            await sleep(getRetryDelayMs(attempt));
        }
    }

    throw new Error(`Overpass request failed:\n${errors.join('\n')}`);
}

function getRetryDelayMs(attempt) {
    return requestDelayMs + Math.min(30000, 2500 * (attempt + 1) ** 2);
}

function sleep(ms) {
    return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function buildRoadMarkingFeatures(elements) {
    const features = [];

    for (const element of elements) {
        const tags = element.tags ?? {};
        const coordinates = getElementCoordinates(element);

        if (!tags.highway || coordinates.length < 2) {
            continue;
        }

        const roadId = `osm_way_${element.id}`;
        const roadClass = normalizeRoadClass(tags.highway);
        const isLink = String(tags.highway).endsWith('_link');
        const laneModel = getLaneModel(tags, roadClass, isLink);
        const detailQuality = laneModel.hasExplicitLaneDetail ? 'osm_explicit' : 'osm_estimated';

        addRoadEdges(features, element, roadId, coordinates, laneModel, detailQuality);
        addLaneMarkings(features, element, roadId, coordinates, laneModel, detailQuality);
        addBusLanes(features, element, roadId, coordinates, laneModel, detailQuality, tags);
        addTurnArrows(features, element, roadId, coordinates, laneModel, detailQuality, roadClass, isLink);
    }

    return features;
}

function addRoadEdges(features, element, roadId, coordinates, laneModel, detailQuality) {
    const edgeOffset = Math.max(1.9, (laneModel.total * laneModel.laneWidthMeters) / 2);

    for (const [side, offsetMeters] of [['left', -edgeOffset], ['right', edgeOffset]]) {
        features.push(makeLineFeature({
            id: `lane_marking/edge/${element.id}/${side}`,
            coordinates,
            properties: {
                feature_type: 'lane_marking',
                road_id: roadId,
                marking_id: `edge_${element.id}_${side}`,
                marking_type: 'edge_line',
                color: 'muted',
                side,
                detail_quality: detailQuality,
                offset_m: offsetMeters,
                offset_px: metersToOffsetPixels(offsetMeters),
                source: 'osm_derived',
                osm_type: element.type,
                osm_id: element.id,
            },
        }));
    }
}

function addLaneMarkings(features, element, roadId, coordinates, laneModel, detailQuality) {
    if (laneModel.total < 2) {
        return;
    }

    for (let boundary = 1; boundary < laneModel.total; boundary += 1) {
        const offsetMeters = (boundary - (laneModel.total / 2)) * laneModel.laneWidthMeters;
        const isDirectionBoundary = !laneModel.oneway && boundary === laneModel.backward;
        const markingType = isDirectionBoundary ? 'double_solid' : 'dashed';

        features.push(makeLineFeature({
            id: `lane_marking/${element.id}/${boundary}`,
            coordinates,
            properties: {
                feature_type: 'lane_marking',
                road_id: roadId,
                marking_id: `marking_${element.id}_${boundary}`,
                marking_type: markingType,
                color: 'white',
                between_lanes: `${boundary}|${boundary + 1}`,
                detail_quality: detailQuality,
                offset_m: offsetMeters,
                offset_px: metersToOffsetPixels(offsetMeters),
                source: laneModel.hasExplicitLaneDetail ? 'osm_explicit_lanes' : 'osm_estimated_lanes',
                osm_type: element.type,
                osm_id: element.id,
            },
        }));
    }
}

function addBusLanes(features, element, roadId, coordinates, laneModel, detailQuality, tags) {
    for (const lane of laneModel.lanes) {
        if (lane.type !== 'bus') {
            continue;
        }

        features.push(makeLineFeature({
            id: `bus_lane/${element.id}/${lane.index}`,
            coordinates,
            properties: {
                feature_type: 'bus_lane',
                road_id: roadId,
                lane_id: `${roadId}_lane_${lane.index}`,
                direction: lane.direction,
                active_hours: tags['bus:lanes:conditional'] ?? tags['vehicle:lanes:conditional'] ?? '',
                detail_quality: detailQuality,
                offset_m: lane.offsetMeters,
                offset_px: lane.offsetPixels,
                source: 'osm_bus_lanes',
                osm_type: element.type,
                osm_id: element.id,
            },
        }));
    }
}

function addTurnArrows(features, element, roadId, coordinates, laneModel, detailQuality, roadClass, isLink) {
    const isMajor = ['motorway', 'trunk', 'primary', 'secondary'].includes(roadClass);
    const ratios = isMajor && !isLink ? [0.35, 0.72] : [0.7];

    for (const lane of laneModel.lanes) {
        const turn = lane.turn && lane.turn !== 'none' ? lane.turn : 'none';

        if (turn === 'none') {
            continue;
        }

        for (const ratio of ratios) {
            const point = offsetPointAtRatio(coordinates, ratio, lane.offsetMeters);
            if (!point) {
                continue;
            }

            features.push({
                type: 'Feature',
                id: `turn_arrow/${element.id}/${lane.index}/${String(ratio).replace('.', '_')}`,
                properties: {
                    feature_type: 'turn_arrow',
                    road_id: roadId,
                    lane_id: `${roadId}_lane_${lane.index}`,
                    arrow_id: `arrow_${element.id}_${lane.index}_${String(ratio).replace('.', '_')}`,
                    lane_index: lane.index,
                    direction: lane.direction,
                    turn,
                    bearing: point.bearing,
                    detail_quality: detailQuality,
                    source: 'osm_turn_lanes',
                    osm_type: element.type,
                    osm_id: element.id,
                },
                geometry: {
                    type: 'Point',
                    coordinates: point.coordinate,
                },
            });
        }
    }
}

function makeLineFeature({ id, coordinates, properties }) {
    return {
        type: 'Feature',
        id,
        properties,
        geometry: {
            type: 'LineString',
            coordinates,
        },
    };
}

function getLaneModel(tags, roadClass, isLink) {
    const oneway = isOneway(tags, roadClass, isLink);
    const total = clampInt(tags.lanes, defaultLaneCount(roadClass, oneway, isLink), 1, 8);
    const forward = oneway
        ? total
        : clampInt(tags['lanes:forward'], Math.ceil(total / 2), 0, total);
    const backward = oneway
        ? 0
        : clampInt(tags['lanes:backward'], total - forward, 0, total);
    const laneWidthMeters = Number(tags.width) > 0 && total > 0
        ? Math.max(2.7, Math.min(4.2, Number(tags.width) / total))
        : (isLink ? 3.35 : 3.55);
    const turns = getTurnLaneValues(tags, total, oneway, forward, backward);
    const busLaneValues = [
        ...getLaneValues(tags['bus:lanes'] ?? tags['psv:lanes'], total),
        ...getLaneValues(tags['bus:lanes:forward'], forward),
        ...getLaneValues(tags['bus:lanes:backward'], backward),
    ];
    const hasExplicitLanes = hasAnyTag(tags, ['lanes', 'lanes:forward', 'lanes:backward', 'width']);
    const hasTurnLanes = hasAnyTag(tags, ['turn:lanes', 'turn:lanes:forward', 'turn:lanes:backward']);
    const hasBusLanes = hasAnyTag(tags, ['bus:lanes', 'bus:lanes:forward', 'bus:lanes:backward', 'psv:lanes', 'busway', 'busway:left', 'busway:right']);
    const hasExplicitLaneDetail = hasExplicitLanes || hasTurnLanes || hasBusLanes;
    const lanes = Array.from({ length: total }, (_, zeroIndex) => {
        const index = zeroIndex + 1;
        const offsetMeters = (zeroIndex - ((total - 1) / 2)) * laneWidthMeters;
        const direction = oneway || index > backward ? 'forward' : 'backward';
        const laneType = isBusLaneValue(busLaneValues[zeroIndex]) || isSideBusLane(tags, zeroIndex, total) ? 'bus' : 'regular';

        return {
            index,
            direction,
            type: laneType,
            turn: turns[zeroIndex] ?? 'none',
            offsetMeters,
            offsetPixels: metersToOffsetPixels(offsetMeters),
        };
    });

    return {
        oneway,
        total,
        forward,
        backward,
        laneWidthMeters,
        hasExplicitLaneDetail,
        lanes,
    };
}

function hasAnyTag(tags, keys) {
    return keys.some((key) => tags[key] !== undefined && tags[key] !== '');
}

function getTurnLaneValues(tags, total, oneway, forward, backward) {
    const all = getLaneValues(tags['turn:lanes'], total);
    if (all.length === total) {
        return all.map(normalizeTurnLane);
    }

    if (oneway) {
        return Array.from({ length: total }, () => 'none');
    }

    const backwardTurns = getLaneValues(tags['turn:lanes:backward'], backward).map(normalizeTurnLane);
    const forwardTurns = getLaneValues(tags['turn:lanes:forward'], forward).map(normalizeTurnLane);

    return [
        ...padLaneValues(backwardTurns, backward),
        ...padLaneValues(forwardTurns, forward),
    ].slice(0, total);
}

function getLaneValues(value, expectedCount) {
    if (!value || typeof value !== 'string') {
        return [];
    }

    const values = value.split('|').map((item) => item.trim()).filter(Boolean);

    return expectedCount ? values.slice(0, expectedCount) : values;
}

function padLaneValues(values, count) {
    return Array.from({ length: count }, (_, index) => values[index] ?? 'none');
}

function normalizeTurnLane(value) {
    const turns = String(value || '')
        .split(';')
        .map((turn) => turn.trim())
        .filter(Boolean);

    if (turns.length === 0) {
        return 'none';
    }

    const hasThrough = turns.includes('through');
    const hasLeft = turns.some((turn) => turn.includes('left'));
    const hasRight = turns.some((turn) => turn.includes('right'));
    const hasReverse = turns.includes('reverse') || turns.includes('uturn');

    if (hasReverse) return 'u_turn';
    if (hasThrough && hasLeft) return 'through_left';
    if (hasThrough && hasRight) return 'through_right';
    if (hasLeft && hasRight) return 'left_right';
    if (turns.includes('slight_left')) return 'slight_left';
    if (turns.includes('slight_right')) return 'slight_right';
    if (hasLeft) return 'left';
    if (hasRight) return 'right';
    if (hasThrough) return 'through';

    return 'none';
}

function isBusLaneValue(value) {
    return ['yes', 'designated', 'official', 'permissive'].includes(String(value || '').toLowerCase());
}

function isSideBusLane(tags, laneIndex, total) {
    const left = String(tags['busway:left'] ?? '').toLowerCase() === 'lane';
    const right = String(tags['busway:right'] ?? tags.busway ?? '').toLowerCase() === 'lane';

    return (left && laneIndex === 0) || (right && laneIndex === total - 1);
}

function isOneway(tags, roadClass, isLink) {
    const value = String(tags.oneway ?? '').toLowerCase();

    return value === 'yes'
        || value === '1'
        || value === 'true'
        || roadClass === 'motorway'
        || isLink;
}

function defaultLaneCount(roadClass, oneway, isLink) {
    if (isLink) return 1;
    if (roadClass === 'motorway') return oneway ? 4 : 8;
    if (['trunk', 'primary'].includes(roadClass)) return oneway ? 3 : 6;
    if (['secondary', 'tertiary'].includes(roadClass)) return oneway ? 2 : 4;

    return oneway ? 1 : 2;
}

function normalizeRoadClass(highway) {
    const value = String(highway || '').replace(/_link$/, '');

    if (['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor', 'service'].includes(value)) {
        return value;
    }

    if (value === 'residential' || value === 'unclassified' || value === 'living_street') {
        return 'minor';
    }

    return 'service';
}

function getElementCoordinates(element) {
    if (Array.isArray(element.geometry)) {
        return element.geometry
            .map((point) => [Number(point.lon), Number(point.lat)])
            .filter(([lon, lat]) => Number.isFinite(lon) && Number.isFinite(lat));
    }

    return [];
}

function offsetPointAtRatio(coordinates, ratio, offsetMeters) {
    if (coordinates.length < 2) {
        return null;
    }

    const targetIndex = Math.max(0, Math.min(coordinates.length - 2, Math.floor((coordinates.length - 1) * ratio)));
    const start = coordinates[targetIndex];
    const finish = coordinates[targetIndex + 1];
    const bearing = getBearing(start, finish);
    const coordinate = offsetCoordinate([
        start[0] + ((finish[0] - start[0]) * 0.5),
        start[1] + ((finish[1] - start[1]) * 0.5),
    ], bearing + 90, offsetMeters);

    return {
        coordinate,
        bearing,
    };
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

function metersToOffsetPixels(meters) {
    return Math.round(Number(meters) * 1.35 * 10) / 10;
}

function clampInt(value, fallback, min, max) {
    const number = Number.parseInt(value, 10);
    const safe = Number.isFinite(number) ? number : fallback;

    return Math.max(min, Math.min(max, safe));
}

function parseBbox(value) {
    const parts = String(value).split(',').map((part) => Number(part.trim()));

    if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) {
        throw new Error('Bbox must be "south,west,north,east".');
    }

    return parts;
}

function shouldChunkBbox([south, west, north, east]) {
    return Math.abs(north - south) * Math.abs(east - west) > 0.08;
}

function makeBboxChunks([south, west, north, east], count) {
    if (count <= 1) {
        return [[south, west, north, east]];
    }

    const chunks = [];
    const latStep = (north - south) / count;
    const lonStep = (east - west) / count;

    for (let y = 0; y < count; y += 1) {
        for (let x = 0; x < count; x += 1) {
            chunks.push([
                roundCoordinate(south + (latStep * y)),
                roundCoordinate(west + (lonStep * x)),
                roundCoordinate(y === count - 1 ? north : south + (latStep * (y + 1))),
                roundCoordinate(x === count - 1 ? east : west + (lonStep * (x + 1))),
            ]);
        }
    }

    return chunks;
}

function roundCoordinate(value) {
    return Math.round(Number(value) * 1000000) / 1000000;
}

function toRadians(value) {
    return Number(value) * Math.PI / 180;
}

function toDegrees(value) {
    return Number(value) * 180 / Math.PI;
}
