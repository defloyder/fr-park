#!/usr/bin/env node

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const DEFAULT_BBOX = '55.48,37.30,55.96,37.96'; // south,west,north,east: Moscow core
const OUTPUT_PATH = resolve(process.argv[3] ?? 'public/data/road-details/road-details.geojson');
const bbox = parseBbox(process.argv[2] ?? process.env.ROAD_DETAILS_BBOX ?? DEFAULT_BBOX);

const query = `
[out:json][timeout:180];
(
  way["highway"]["highway"!~"footway|path|cycleway|steps|corridor|platform"](${bbox.join(',')});
  way["area:highway"~"traffic_island|painted_area|separator|traffic_calming"](${bbox.join(',')});
  relation["area:highway"~"traffic_island|painted_area|separator|traffic_calming"](${bbox.join(',')});
);
out tags geom;
`;

const payload = await fetchOverpass(query);
const features = buildRoadDetailFeatures(payload.elements ?? []);

mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
writeFileSync(OUTPUT_PATH, `${JSON.stringify({
    type: 'FeatureCollection',
    name: 'road-details',
    generated_at: new Date().toISOString(),
    bbox: {
        south: bbox[0],
        west: bbox[1],
        north: bbox[2],
        east: bbox[3],
    },
    features,
}, null, 2)}\n`);

console.log(`Wrote ${features.length} road detail features to ${OUTPUT_PATH}`);

async function fetchOverpass(overpassQuery) {
    const endpoints = (process.env.OVERPASS_URL ? [process.env.OVERPASS_URL] : [
        'https://overpass-api.de/api/interpreter',
        'https://overpass.kumi.systems/api/interpreter',
        'https://overpass.private.coffee/api/interpreter',
    ]);
    const errors = [];

    for (const endpoint of endpoints) {
        try {
            console.log(`Querying ${endpoint} ...`);
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
                    accept: 'application/json',
                },
                body: new URLSearchParams({ data: overpassQuery }),
            });

            if (!response.ok) {
                throw new Error(`${endpoint} returned ${response.status}`);
            }

            return response.json();
        } catch (error) {
            errors.push(error.message);
        }
    }

    throw new Error(`Overpass request failed:\n${errors.join('\n')}`);
}

function buildRoadDetailFeatures(elements) {
    const features = [];

    for (const element of elements) {
        const tags = element.tags ?? {};
        const coordinates = getElementCoordinates(element);

        if (coordinates.length < 2) {
            continue;
        }

        if (tags['area:highway']) {
            const polygon = closeRing(coordinates);
            if (polygon.length >= 4) {
                features.push({
                    type: 'Feature',
                    id: `gore_area/${element.type}/${element.id}`,
                    properties: {
                        feature_type: 'gore_area',
                        gore_id: `gore_${element.id}`,
                        gore_type: normalizeGoreType(tags['area:highway']),
                        osm_type: element.type,
                        osm_id: element.id,
                        source: 'osm',
                    },
                    geometry: {
                        type: 'Polygon',
                        coordinates: [polygon],
                    },
                });
            }
            continue;
        }

        if (!tags.highway) {
            continue;
        }

        const roadId = `osm_way_${element.id}`;
        const roadClass = normalizeRoadClass(tags.highway);
        const laneModel = getLaneModel(tags, roadClass);
        const detailQuality = laneModel.hasExplicitLaneDetail ? 'explicit_lane_tags' : 'road_geometry_only';
        const centerline = makeLineFeature({
            id: `road_centerline/${element.id}`,
            coordinates,
            properties: {
                feature_type: 'road_centerline',
                road_id: roadId,
                name: tags.name ?? '',
                class: roadClass,
                oneway: laneModel.oneway,
                lanes_total: laneModel.total,
                lanes_forward: laneModel.forward,
                lanes_backward: laneModel.backward,
                surface: tags.surface ?? '',
                maxspeed: parseMaxspeed(tags.maxspeed),
                detail_quality: detailQuality,
                bridge: tags.bridge === 'yes' || tags.brunnel === 'bridge',
                tunnel: tags.tunnel === 'yes' || tags.brunnel === 'tunnel',
                z_order: Number(tags.layer ?? 0) || 0,
                osm_type: element.type,
                osm_id: element.id,
                source: 'osm',
            },
        });

        features.push(centerline);

        for (const lane of laneModel.lanes) {
            features.push(makeLineFeature({
                id: `road_lane/${element.id}/${lane.index}`,
                coordinates,
                properties: {
                    feature_type: 'road_lane',
                    road_id: roadId,
                    lane_id: `${roadId}_lane_${lane.index}`,
                    lane_index: lane.index,
                    direction: lane.direction,
                    lane_type: lane.type,
                    turn: lane.turn,
                    detail_quality: detailQuality,
                    width_m: laneModel.laneWidthMeters,
                    offset_m: lane.offsetMeters,
                    offset_px: lane.offsetPixels,
                    osm_type: element.type,
                    osm_id: element.id,
                    source: 'osm',
                },
            }));

            if (lane.type === 'bus') {
                features.push(makeLineFeature({
                    id: `bus_lane/${element.id}/${lane.index}`,
                    coordinates,
                    properties: {
                        feature_type: 'bus_lane',
                        road_id: roadId,
                        lane_id: `${roadId}_lane_${lane.index}`,
                        direction: lane.direction,
                        access: 'bus,taxi,emergency',
                        active_hours: tags['bus:lanes:conditional'] ?? tags['vehicle:lanes:conditional'] ?? '',
                        detail_quality: detailQuality,
                        offset_m: lane.offsetMeters,
                        offset_px: lane.offsetPixels,
                        osm_type: element.type,
                        osm_id: element.id,
                        source: 'osm',
                    },
                }));
            }

            if (lane.turn && lane.turn !== 'none') {
                const point = offsetPointAtRatio(coordinates, 0.78, lane.offsetMeters);
                if (point) {
                    features.push({
                        type: 'Feature',
                        id: `turn_arrow/${element.id}/${lane.index}`,
                        properties: {
                            feature_type: 'turn_arrow',
                            road_id: roadId,
                            lane_id: `${roadId}_lane_${lane.index}`,
                            arrow_id: `arrow_${element.id}_${lane.index}`,
                            lane_index: lane.index,
                            direction: lane.direction,
                            turn: lane.turn,
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

        if (!laneModel.hasExplicitLaneDetail) {
            continue;
        }

        for (let boundary = 1; boundary < laneModel.total; boundary += 1) {
            const offsetMeters = ((boundary - (laneModel.total / 2)) * laneModel.laneWidthMeters);
            const offsetPixels = metersToOffsetPixels(offsetMeters);
            const isDirectionBoundary = !laneModel.oneway && boundary === laneModel.backward;

            features.push(makeLineFeature({
                id: `lane_marking/${element.id}/${boundary}`,
                coordinates,
                properties: {
                    feature_type: 'lane_marking',
                    road_id: roadId,
                    marking_id: `marking_${element.id}_${boundary}`,
                    marking_type: isDirectionBoundary ? 'solid' : 'dashed',
                    color: 'white',
                    between_lanes: `${boundary}|${boundary + 1}`,
                    marking_source: 'explicit_lanes',
                    width_m: isDirectionBoundary ? 0.18 : 0.15,
                    offset_m: offsetMeters,
                    offset_px: offsetPixels,
                    source: 'osm_derived',
                    osm_type: element.type,
                    osm_id: element.id,
                },
            }));
        }

        const edgeOffset = (laneModel.total * laneModel.laneWidthMeters) / 2;
        features.push(makeLineFeature({
            id: `road_edge/${element.id}/left`,
            coordinates,
            properties: {
                feature_type: 'road_edge',
                road_id: roadId,
                edge_id: `edge_${element.id}_left`,
                edge_type: 'carriageway_edge',
                detail_quality: detailQuality,
                offset_m: -edgeOffset,
                offset_px: metersToOffsetPixels(-edgeOffset),
                source: 'osm_derived',
            },
        }));
        features.push(makeLineFeature({
            id: `road_edge/${element.id}/right`,
            coordinates,
            properties: {
                feature_type: 'road_edge',
                road_id: roadId,
                edge_id: `edge_${element.id}_right`,
                edge_type: 'carriageway_edge',
                detail_quality: detailQuality,
                offset_m: edgeOffset,
                offset_px: metersToOffsetPixels(edgeOffset),
                source: 'osm_derived',
            },
        }));
    }

    return features;
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

function getLaneModel(tags, roadClass) {
    const oneway = isOneway(tags, roadClass);
    const total = clampInt(tags.lanes, defaultLaneCount(roadClass, oneway), 1, 8);
    const forward = oneway
        ? total
        : clampInt(tags['lanes:forward'], Math.ceil(total / 2), 0, total);
    const backward = oneway
        ? 0
        : clampInt(tags['lanes:backward'], total - forward, 0, total);
    const laneWidthMeters = Number(tags.width) > 0 && total > 0
        ? Math.max(2.7, Math.min(4.2, Number(tags.width) / total))
        : 3.5;
    const turns = getTurnLaneValues(tags, total, oneway, forward, backward);
    const busLaneValues = getLaneValues(tags['bus:lanes'] ?? tags['psv:lanes'], total);
    const hasExplicitLanes = hasAnyTag(tags, ['lanes', 'lanes:forward', 'lanes:backward', 'width']);
    const hasTurnLanes = hasAnyTag(tags, ['turn:lanes', 'turn:lanes:forward', 'turn:lanes:backward']);
    const hasBusLanes = hasAnyTag(tags, ['bus:lanes', 'psv:lanes']);
    const hasExplicitLaneDetail = hasExplicitLanes || hasTurnLanes || hasBusLanes;
    const lanes = Array.from({ length: total }, (_, zeroIndex) => {
        const index = zeroIndex + 1;
        const offsetMeters = (zeroIndex - ((total - 1) / 2)) * laneWidthMeters;
        const direction = oneway || index > backward ? 'forward' : 'backward';
        const laneType = isBusLaneValue(busLaneValues[zeroIndex]) ? 'bus' : 'regular';

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

function isOneway(tags, roadClass) {
    const value = String(tags.oneway ?? '').toLowerCase();

    return value === 'yes'
        || value === '1'
        || value === 'true'
        || roadClass === 'motorway';
}

function defaultLaneCount(roadClass, oneway) {
    if (roadClass === 'motorway') return oneway ? 3 : 6;
    if (['trunk', 'primary'].includes(roadClass)) return oneway ? 3 : 4;
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

function normalizeGoreType(value) {
    const normalized = String(value || '').toLowerCase();

    if (normalized.includes('traffic_island')) return 'traffic_island';
    if (normalized.includes('painted')) return 'painted_gore';
    if (normalized.includes('separator')) return 'separator';

    return normalized || 'unknown';
}

function getElementCoordinates(element) {
    if (Array.isArray(element.geometry)) {
        return element.geometry
            .map((point) => [Number(point.lon), Number(point.lat)])
            .filter(([lon, lat]) => Number.isFinite(lon) && Number.isFinite(lat));
    }

    return [];
}

function closeRing(coordinates) {
    const ring = [...coordinates];
    const first = ring[0];
    const last = ring.at(-1);

    if (first && last && (first[0] !== last[0] || first[1] !== last[1])) {
        ring.push(first);
    }

    return ring;
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

function parseMaxspeed(value) {
    const speed = Number(String(value ?? '').match(/\d+/)?.[0]);

    return Number.isFinite(speed) ? speed : null;
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

function toRadians(value) {
    return Number(value) * Math.PI / 180;
}

function toDegrees(value) {
    return Number(value) * 180 / Math.PI;
}
