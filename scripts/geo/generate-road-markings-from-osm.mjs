#!/usr/bin/env node

import { createReadStream, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createGunzip } from 'node:zlib';
import { createInterface } from 'node:readline';

const DEFAULT_BBOX = '55.48,37.30,55.96,37.96'; // south,west,north,east: Moscow core
const sourceArg = process.argv[2] ?? process.env.ROAD_MARKINGS_OSM_XML ?? process.env.ROAD_MARKINGS_BBOX ?? DEFAULT_BBOX;
const OUTPUT_PATH = resolve(process.argv[3] ?? 'public/data/road-markings/road-markings.geojson');
const isOsmXmlInput = /\.osm(\.gz)?$/i.test(sourceArg);
const bbox = isOsmXmlInput ? null : parseBbox(sourceArg);
const chunkCount = clampInt(process.argv[4] ?? process.env.ROAD_MARKINGS_CHUNKS, bbox && shouldChunkBbox(bbox) ? 4 : 1, 1, 16);
const requestRetries = clampInt(process.env.OVERPASS_RETRIES, 2, 0, 8);
const requestDelayMs = clampInt(process.env.OVERPASS_DELAY_MS, 1800, 0, 60000);
const requestTimeoutSeconds = clampInt(process.env.OVERPASS_TIMEOUT_SECONDS, 240, 30, 600);
const requestSplitDepth = clampInt(process.env.OVERPASS_SPLIT_DEPTH, 3, 0, 6);

const elementById = new Map();
let endpointCursor = 0;
let outputBbox = bboxToObject(bbox);

if (isOsmXmlInput) {
    const source = resolve(sourceArg);
    const parsed = await readRoadElementsFromOsmXml(source);

    outputBbox = parsed.bbox;

    for (const element of [...parsed.elements, ...parsed.signalNodes]) {
        elementById.set(`${element.type}/${element.id}`, element);
    }
} else {
    for (const chunk of makeBboxChunks(bbox, chunkCount)) {
        const payloads = await fetchOverpassChunk(chunk);

        for (const payload of payloads) {
            for (const element of payload.elements ?? []) {
                elementById.set(`${element.type}/${element.id}`, element);
            }
        }
    }
}

const features = buildRoadMarkingFeatures([...elementById.values()]);

function buildRoadQuery(targetBbox) {
    const bboxString = targetBbox.join(',');

    return `
[out:json][timeout:${requestTimeoutSeconds}];
(
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary)$"]["lanes"](${bboxString});
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary)$"]["lanes:forward"](${bboxString});
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary)$"]["lanes:backward"](${bboxString});
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary)$"]["turn:lanes"](${bboxString});
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary)$"]["turn:lanes:forward"](${bboxString});
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary)$"]["turn:lanes:backward"](${bboxString});
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary)$"]["bus:lanes"](${bboxString});
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary)$"]["bus:lanes:forward"](${bboxString});
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary)$"]["bus:lanes:backward"](${bboxString});
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary)$"]["psv:lanes"](${bboxString});
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary)$"]["busway"](${bboxString});
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary)$"]["busway:left"](${bboxString});
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary)$"]["busway:right"](${bboxString});
);
out tags geom;
`;
}

mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
writeFileSync(OUTPUT_PATH, `${JSON.stringify({
    type: 'FeatureCollection',
    name: 'road-markings',
    generated_at: new Date().toISOString(),
    bbox: outputBbox,
    features,
}, null, process.env.ROAD_MARKINGS_PRETTY === '1' ? 2 : 0)}\n`);

console.log(`Wrote ${features.length} road marking features to ${OUTPUT_PATH}`);

async function readRoadElementsFromOsmXml(source) {
    const ways = [];
    const neededNodeIds = new Set();
    let bboxFromFile = null;
    let currentWay = null;

    console.log(`Reading OSM ways from ${source} ...`);

    for await (const rawLine of readOsmLines(source)) {
        const line = rawLine.trim();

        if (!bboxFromFile && line.startsWith('<bounds ')) {
            bboxFromFile = parseBoundsLine(line);
            continue;
        }

        if (line.startsWith('<way ')) {
            currentWay = {
                type: 'way',
                id: getXmlAttribute(line, 'id'),
                refs: [],
                tags: {},
            };
            continue;
        }

        if (!currentWay) {
            continue;
        }

        if (line.startsWith('<nd ')) {
            const ref = getXmlAttribute(line, 'ref');

            if (ref) {
                currentWay.refs.push(ref);
            }

            continue;
        }

        if (line.startsWith('<tag ')) {
            const key = decodeXmlAttribute(getXmlAttribute(line, 'k'));
            const value = decodeXmlAttribute(getXmlAttribute(line, 'v'));

            if (key) {
                currentWay.tags[key] = value;
            }

            continue;
        }

        if (line.startsWith('</way>')) {
            if (isRoadMarkingCandidate(currentWay.tags) && currentWay.refs.length >= 2) {
                ways.push(currentWay);

                for (const ref of currentWay.refs) {
                    neededNodeIds.add(ref);
                }
            }

            currentWay = null;
        }
    }

    const nodeById = new Map();
    const signalNodes = [];
    let currentNode = null;

    console.log(`Reading ${neededNodeIds.size} referenced OSM nodes ...`);

    for await (const rawLine of readOsmLines(source)) {
        const line = rawLine.trim();

        if (line.startsWith('<node ')) {
            const id = getXmlAttribute(line, 'id');
            const lat = Number(getXmlAttribute(line, 'lat'));
            const lon = Number(getXmlAttribute(line, 'lon'));

            if (!neededNodeIds.has(id) || !Number.isFinite(lat) || !Number.isFinite(lon)) {
                currentNode = null;
                continue;
            }

            currentNode = {
                type: 'node',
                id,
                tags: {},
                geometry: [{ id, lat, lon }],
            };

            if (line.endsWith('/>')) {
                nodeById.set(id, currentNode.geometry[0]);
                currentNode = null;
            }

            continue;
        }

        if (!currentNode) {
            continue;
        }

        if (line.startsWith('<tag ')) {
            const key = decodeXmlAttribute(getXmlAttribute(line, 'k'));
            const value = decodeXmlAttribute(getXmlAttribute(line, 'v'));

            if (key) {
                currentNode.tags[key] = value;
            }

            continue;
        }

        if (line.startsWith('</node>')) {
            const point = currentNode.geometry[0];

            nodeById.set(currentNode.id, {
                ...point,
                tags: currentNode.tags,
            });

            if (currentNode.tags.highway === 'traffic_signals') {
                signalNodes.push(currentNode);
            }

            currentNode = null;
        }
    }

    const elements = ways
        .map((way) => ({
            type: 'way',
            id: way.id,
            tags: way.tags,
            refs: way.refs,
            geometry: way.refs
                .map((ref) => nodeById.get(ref))
                .filter(Boolean),
        }))
        .filter((way) => way.geometry.length >= 2);

    console.log(`Loaded ${elements.length} road ways with explicit lane data.`);

    return {
        bbox: bboxFromFile,
        elements,
        signalNodes,
    };
}

function readOsmLines(source) {
    const input = createReadStream(source);
    const stream = /\.gz$/i.test(source) ? input.pipe(createGunzip()) : input;

    return createInterface({
        input: stream,
        crlfDelay: Infinity,
    });
}

function isRoadMarkingCandidate(tags) {
    const roadClass = normalizeRoadClass(tags.highway);
    const isLink = String(tags.highway || '').endsWith('_link');

    return shouldRenderLaneMarkings(roadClass, isLink);
}

function parseBoundsLine(line) {
    return {
        south: Number(getXmlAttribute(line, 'minlat')),
        west: Number(getXmlAttribute(line, 'minlon')),
        north: Number(getXmlAttribute(line, 'maxlat')),
        east: Number(getXmlAttribute(line, 'maxlon')),
    };
}

function getXmlAttribute(line, name) {
    const match = line.match(new RegExp(`\\s${name}=(?:"([^"]*)"|'([^']*)')`));

    return match ? match[1] ?? match[2] ?? '' : '';
}

function decodeXmlAttribute(value) {
    return String(value || '')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&');
}

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

async function fetchOverpassChunk(chunk, depth = 0) {
    try {
        const payload = await fetchOverpass(buildRoadQuery(chunk));

        if (requestDelayMs > 0) {
            await sleep(requestDelayMs);
        }

        return [payload];
    } catch (error) {
        if (depth >= requestSplitDepth) {
            throw error;
        }

        console.warn(`Splitting bbox ${chunk.join(',')} after Overpass failure: ${error.message.split('\n')[0]}`);

        const payloads = [];

        for (const subChunk of makeBboxChunks(chunk, 2)) {
            payloads.push(...await fetchOverpassChunk(subChunk, depth + 1));
        }

        return payloads;
    }
}

function getRetryDelayMs(attempt) {
    return requestDelayMs + Math.min(30000, 2500 * (attempt + 1) ** 2);
}

function sleep(ms) {
    return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function buildRoadMarkingFeatures(elements) {
    const features = [];
    const intersectionNodes = clusterIntersectionNodes(getIntersectionNodes(elements));

    for (const element of elements) {
        const tags = element.tags ?? {};
        const coordinates = getElementCoordinates(element);

        if (element.type === 'node') {
            addTrafficSignal(features, element);
            continue;
        }

        if (!tags.highway || coordinates.length < 2) {
            continue;
        }

        const roadId = `osm_way_${element.id}`;
        const roadClass = normalizeRoadClass(tags.highway);
        const isLink = String(tags.highway).endsWith('_link');
        const structure = getRoadStructure(tags);
        const laneModel = getLaneModel(tags, roadClass, isLink);
        const detailQuality = laneModel.hasExplicitLaneDetail ? 'osm_explicit' : 'osm_estimated';

        addRoadMask(features, element, roadId, coordinates, laneModel, roadClass, isLink, structure);
        addRoadEdges(features, element, roadId, coordinates, laneModel, detailQuality, roadClass, isLink, structure);
        addLaneMarkings(features, element, roadId, coordinates, laneModel, detailQuality, roadClass, isLink, structure);
        addBusLanes(features, element, roadId, coordinates, laneModel, detailQuality, tags, roadClass, isLink, structure);
        addCrosswalks(features, element, roadId, coordinates, laneModel, roadClass, isLink, structure);
        addSpeedMarking(features, element, roadId, coordinates, laneModel, roadClass, isLink, structure);
        addTurnArrows(features, element, roadId, coordinates, laneModel, detailQuality, roadClass, isLink, structure);
    }

    addIntersectionMasks(features, intersectionNodes);
    addYellowBoxMarkings(features, intersectionNodes);

    return features;
}

function addTrafficSignal(features, element) {
    const tags = element.tags ?? {};
    const point = getElementCoordinates(element)[0];

    if (tags.highway !== 'traffic_signals' || !point) {
        return;
    }

    features.push({
        type: 'Feature',
        id: `traffic_signal/${element.id}`,
        properties: {
            feature_type: 'traffic_signal',
            osm_id: element.id,
        },
        geometry: {
            type: 'Point',
            coordinates: roundCoordinatePair(point),
        },
    });
}

function addRoadMask(features, element, roadId, coordinates, laneModel, roadClass, isLink, structure) {
    if (!shouldRenderLaneMarkings(roadClass, isLink) || structure.structure_level < 1) {
        return;
    }

    features.push(makeLineFeature({
        id: `road_mask/${element.id}`,
        coordinates,
        properties: {
            feature_type: 'road_mask',
            road_id: roadId,
            road_class: roadClass,
            is_link: isLink,
            lanes_total: laneModel.total,
            lane_width_m: laneModel.laneWidthMeters,
            road_width_m: laneModel.total * laneModel.laneWidthMeters,
            ...structure,
            source: 'osm_bridge_mask',
            osm_type: element.type,
            osm_id: element.id,
        },
    }));
}

function addRoadEdges(features, element, roadId, coordinates, laneModel, detailQuality, roadClass, isLink, structure) {
    if (!shouldRenderRoadEdges(roadClass, isLink) || !laneModel.hasExplicitLaneDetail) {
        return;
    }

    const edgeOffset = Math.max(1.6, (((laneModel.total - 1) / 2) * laneModel.laneWidthMeters) + 0.75);

    for (const [side, offsetMeters] of [['left', -edgeOffset], ['right', edgeOffset]]) {
        features.push(makeLineFeature({
            id: `lane_marking/edge/${element.id}/${side}`,
            coordinates: offsetLineString(coordinates, offsetMeters),
            properties: {
                feature_type: 'lane_marking',
                road_id: roadId,
                marking_id: `edge_${element.id}_${side}`,
                marking_type: 'edge_line',
                color: 'muted',
                side,
                detail_quality: detailQuality,
                road_class: roadClass,
                is_link: isLink,
                structure_level: structure.structure_level,
                source: 'osm_derived',
                osm_type: element.type,
                osm_id: element.id,
            },
        }));
    }
}

function addLaneMarkings(features, element, roadId, coordinates, laneModel, detailQuality, roadClass, isLink, structure) {
    if (laneModel.total < 2 || !shouldRenderLaneMarkings(roadClass, isLink)) {
        return;
    }

    for (let boundary = 1; boundary < laneModel.total; boundary += 1) {
        const offsetMeters = (boundary - (laneModel.total / 2)) * laneModel.laneWidthMeters;
        const isDirectionBoundary = !laneModel.oneway && boundary === laneModel.backward;
        const markingType = isDirectionBoundary ? 'double_solid' : 'dashed';

        features.push(makeLineFeature({
            id: `lane_marking/${element.id}/${boundary}`,
            coordinates: offsetLineString(coordinates, offsetMeters),
            properties: {
                feature_type: 'lane_marking',
                road_id: roadId,
                marking_id: `marking_${element.id}_${boundary}`,
                marking_type: markingType,
                color: 'white',
                between_lanes: `${boundary}|${boundary + 1}`,
                detail_quality: detailQuality,
                road_class: roadClass,
                is_link: isLink,
                structure_level: structure.structure_level,
                source: laneModel.hasExplicitLaneDetail ? 'osm_explicit_lanes' : 'osm_estimated_lanes',
                osm_type: element.type,
                osm_id: element.id,
            },
        }));
    }
}

function addBusLanes(features, element, roadId, coordinates, laneModel, detailQuality, tags, roadClass, isLink, structure) {
    if (!shouldRenderLaneMarkings(roadClass, isLink)) {
        return;
    }

    const busDirections = new Set();

    for (const lane of laneModel.lanes) {
        if (lane.type !== 'bus') {
            continue;
        }

        if (busDirections.has(lane.direction)) {
            continue;
        }

        busDirections.add(lane.direction);

        features.push(makeLineFeature({
            id: `bus_lane/${element.id}/${lane.index}`,
            coordinates: offsetLineString(coordinates, getBusLaneRenderOffset(lane, laneModel)),
            properties: {
                feature_type: 'bus_lane',
                road_id: roadId,
                lane_id: `${roadId}_lane_${lane.index}`,
                direction: lane.direction,
                active_hours: tags['bus:lanes:conditional'] ?? tags['vehicle:lanes:conditional'] ?? '',
                detail_quality: detailQuality,
                road_class: roadClass,
                is_link: isLink,
                structure_level: structure.structure_level,
                source: 'osm_bus_lanes',
                osm_type: element.type,
                osm_id: element.id,
            },
        }));
    }
}

function addCrosswalks(features, element, roadId, coordinates, laneModel, roadClass, isLink, structure) {
    if (!shouldRenderRoadEdges(roadClass, isLink) || structure.structure_level !== 0) {
        return;
    }

    const geometry = Array.isArray(element.geometry) ? element.geometry : [];
    let count = 0;

    for (let index = 1; index < geometry.length - 1; index += 1) {
        const point = geometry[index];
        const tags = point.tags ?? {};

        if (!isCrossingNode(tags)) {
            continue;
        }

        const center = [Number(point.lon), Number(point.lat)];
        const previous = coordinates[index - 1];
        const next = coordinates[index + 1];

        if (!previous || !next || !Number.isFinite(center[0]) || !Number.isFinite(center[1])) {
            continue;
        }

        const bearing = getBearing(previous, next);
        const halfWidth = getCrosswalkHalfWidth(laneModel);
        const line = [
            offsetCoordinate(center, bearing + 90, -halfWidth),
            offsetCoordinate(center, bearing + 90, halfWidth),
        ];

        features.push(makeLineFeature({
            id: `crosswalk/${element.id}/${point.id ?? index}`,
            coordinates: line,
            properties: {
                feature_type: 'crosswalk',
                crosswalk_id: `crosswalk_${element.id}_${point.id ?? index}`,
                road_id: roadId,
            },
        }));

        count += 1;

        if (count >= 6) {
            return;
        }
    }
}

function addSpeedMarking(features, element, roadId, coordinates, laneModel, roadClass, isLink, structure) {
    if (!shouldRenderRoadEdges(roadClass, isLink) || structure.structure_level !== 0) {
        return;
    }

    const maxspeed = normalizeMaxspeed(element.tags?.maxspeed);

    if (!maxspeed || laneModel.total < 2) {
        return;
    }

    const point = offsetPointAtRatio(coordinates, 0.58, 0);

    if (!point) {
        return;
    }

    features.push({
        type: 'Feature',
        id: `speed_marking/${element.id}`,
        properties: {
            feature_type: 'speed_marking',
            road_id: roadId,
            maxspeed,
            bearing: point.bearing,
        },
        geometry: {
            type: 'Point',
            coordinates: roundCoordinatePair(point.coordinate),
        },
    });
}

function addTurnArrows(features, element, roadId, coordinates, laneModel, detailQuality, roadClass, isLink, structure) {
    if (!shouldRenderLaneMarkings(roadClass, isLink)) {
        return;
    }

    const isMajor = ['motorway', 'trunk', 'primary', 'secondary'].includes(roadClass);
    const ratios = isMajor && !isLink ? [0.64] : [0.68];

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
                    bearing: lane.direction === 'backward' ? (point.bearing + 180) % 360 : point.bearing,
                    detail_quality: detailQuality,
                    road_class: roadClass,
                    is_link: isLink,
                    structure_level: structure.structure_level,
                    source: 'osm_turn_lanes',
                    osm_type: element.type,
                    osm_id: element.id,
                },
                geometry: {
                    type: 'Point',
                    coordinates: roundCoordinatePair(point.coordinate),
                },
            });
        }
    }
}

function addIntersectionMasks(features, intersectionNodes) {
    for (const node of intersectionNodes) {
        for (const approach of node.approaches) {
            if (!approach.neighbor || approach.structure_level !== 0) {
                continue;
            }

            const bearing = getBearing(node.coordinate, approach.neighbor);
            const distance = Math.min(38, Math.max(18, approach.lanes_total * 4.8));
            const end = offsetCoordinate(node.coordinate, bearing, distance);

            features.push(makeLineFeature({
                id: `intersection_mask/${node.id}/${approach.road_id}/${approach.side}`,
                coordinates: [node.coordinate, end],
                properties: {
                    feature_type: 'intersection_mask',
                    mask_id: `mask_${node.id}_${approach.road_id}_${approach.side}`,
                    road_id: approach.road_id,
                    lanes_total: approach.lanes_total,
                },
            }));

            if (node.hasTrafficSignal) {
                const stopCenter = offsetCoordinate(node.coordinate, bearing, distance + 2);
                const crosswalkCenter = offsetCoordinate(node.coordinate, bearing, Math.max(7, distance - 5));
                const halfWidth = Math.min(18, Math.max(6, (approach.lanes_total * approach.lane_width_m) / 2 + 0.8));

                features.push(makeLineFeature({
                    id: `crosswalk/signal/${node.id}/${approach.road_id}/${approach.side}`,
                    coordinates: [
                        offsetCoordinate(crosswalkCenter, bearing + 90, -halfWidth),
                        offsetCoordinate(crosswalkCenter, bearing + 90, halfWidth),
                    ],
                    properties: {
                        feature_type: 'crosswalk',
                        crosswalk_id: `crosswalk_signal_${node.id}_${approach.road_id}_${approach.side}`,
                        road_id: approach.road_id,
                    },
                }));

                features.push(makeLineFeature({
                    id: `stop_line/${node.id}/${approach.road_id}/${approach.side}`,
                    coordinates: [
                        offsetCoordinate(stopCenter, bearing + 90, -halfWidth),
                        offsetCoordinate(stopCenter, bearing + 90, halfWidth),
                    ],
                    properties: {
                        feature_type: 'stop_line',
                        road_id: approach.road_id,
                        stop_line_id: `stop_${node.id}_${approach.road_id}_${approach.side}`,
                    },
                }));
            }
        }
    }
}

function addYellowBoxMarkings(features, intersectionNodes) {
    for (const node of intersectionNodes) {
        if (!node.hasTrafficSignal || node.totalLanes < 10 || node.roads.size < 3) {
            continue;
        }

        const size = Math.min(8, Math.max(5.2, Math.sqrt(node.totalLanes) * 1.55));
        const spacing = 3.4;
        let lineIndex = 0;

        for (let offset = -size; offset <= size; offset += spacing) {
            for (const direction of [-1, 1]) {
                const start = offsetFromBearingAxes(node.coordinate, node.dominantBearing, offset - size, -size * direction);
                const finish = offsetFromBearingAxes(node.coordinate, node.dominantBearing, offset + size, size * direction);

                features.push(makeLineFeature({
                    id: `yellow_box/${node.id}/${lineIndex}`,
                    coordinates: [start, finish],
                    properties: {
                        feature_type: 'yellow_box_line',
                        box_line_id: `box_${node.id}_${lineIndex}`,
                    },
                }));

                lineIndex += 1;
            }
        }
    }
}

function shouldRenderLaneMarkings(roadClass, isLink) {
    return !isLink && ['motorway', 'trunk', 'primary', 'secondary', 'tertiary'].includes(roadClass);
}

function shouldRenderRoadEdges(roadClass, isLink) {
    return !isLink && ['motorway', 'trunk', 'primary'].includes(roadClass);
}

function getBusLaneRenderOffset(lane, laneModel) {
    const edgeOffset = ((laneModel.total - 1) / 2) * laneModel.laneWidthMeters;

    if (lane.direction === 'backward') {
        return -edgeOffset;
    }

    return edgeOffset;
}

function getCrosswalkHalfWidth(laneModel) {
    return Math.min(18, Math.max(6, (laneModel.total * laneModel.laneWidthMeters) / 2 + 0.8));
}

function clusterIntersectionNodes(nodes) {
    const clusters = [];
    const clusterDistanceMeters = 28;

    for (const node of nodes) {
        let cluster = clusters.find((item) => distanceMeters(item.coordinate, node.coordinate) <= clusterDistanceMeters);

        if (!cluster) {
            cluster = {
                id: node.id,
                coordinate: node.coordinate,
                roads: new Set(),
                approaches: [],
                totalLanes: 0,
                hasTrafficSignal: false,
                hasMajorRoad: false,
                dominantBearing: 0,
                count: 0,
            };
            clusters.push(cluster);
        }

        const nextCount = cluster.count + 1;
        cluster.coordinate = [
            ((cluster.coordinate[0] * cluster.count) + node.coordinate[0]) / nextCount,
            ((cluster.coordinate[1] * cluster.count) + node.coordinate[1]) / nextCount,
        ];
        cluster.count = nextCount;
        cluster.hasTrafficSignal = cluster.hasTrafficSignal || node.hasTrafficSignal;
        cluster.hasMajorRoad = cluster.hasMajorRoad || node.hasMajorRoad;

        for (const roadId of node.roads) {
            cluster.roads.add(roadId);
        }

        cluster.totalLanes = Math.max(cluster.totalLanes, node.totalLanes);
        cluster.approaches.push(...node.approaches);
    }

    return clusters
        .map((cluster) => ({
            ...cluster,
            approaches: dedupeIntersectionApproaches(cluster),
            dominantBearing: getDominantIntersectionBearing(cluster),
        }))
        .filter((cluster) => cluster.roads.size >= 2 && cluster.totalLanes >= 5 && cluster.hasMajorRoad && cluster.hasTrafficSignal);
}

function getDominantIntersectionBearing(cluster) {
    const approach = [...cluster.approaches]
        .filter((item) => item.neighbor)
        .sort((left, right) => right.lanes_total - left.lanes_total)[0];

    return approach ? getBearing(cluster.coordinate, approach.neighbor) : 0;
}

function dedupeIntersectionApproaches(cluster) {
    const byKey = new Map();

    for (const approach of cluster.approaches) {
        if (!approach.neighbor) {
            continue;
        }

        const bearingBucket = Math.round(getBearing(cluster.coordinate, approach.neighbor) / 30) * 30;
        const key = `${approach.road_id}:${bearingBucket}`;
        const previous = byKey.get(key);

        if (!previous || approach.lanes_total > previous.lanes_total) {
            byKey.set(key, approach);
        }
    }

    return [...byKey.values()]
        .sort((left, right) => right.lanes_total - left.lanes_total)
        .slice(0, 8);
}

function getIntersectionNodes(elements) {
    const nodes = new Map();

    for (const element of elements) {
        if (element.type !== 'way') {
            continue;
        }

        const tags = element.tags ?? {};
        const roadClass = normalizeRoadClass(tags.highway);
        const isLink = String(tags.highway ?? '').endsWith('_link');
        const structure = getRoadStructure(tags);

        if (!shouldRenderLaneMarkings(roadClass, isLink) || structure.structure_level !== 0) {
            continue;
        }

        const laneModel = getLaneModel(tags, roadClass, isLink);
        const geometry = Array.isArray(element.geometry) ? element.geometry : [];
        const coordinates = getElementCoordinates(element);

        for (let index = 0; index < geometry.length; index += 1) {
            const point = geometry[index];
            const id = point.id ? String(point.id) : '';

            if (!id || !coordinates[index]) {
                continue;
            }

            if (!nodes.has(id)) {
                nodes.set(id, {
                    id,
                    coordinate: coordinates[index],
                    roads: new Set(),
                    approaches: [],
                    totalLanes: 0,
                    hasTrafficSignal: point.tags?.highway === 'traffic_signals',
                    hasMajorRoad: false,
                });
            }

            const node = nodes.get(id);
            const roadId = `osm_way_${element.id}`;

            if (node.roads.has(roadId)) {
                continue;
            }

            node.roads.add(roadId);
            node.totalLanes += laneModel.total;
            node.hasTrafficSignal = node.hasTrafficSignal || point.tags?.highway === 'traffic_signals';
            node.hasMajorRoad = node.hasMajorRoad || ['motorway', 'trunk', 'primary', 'secondary'].includes(roadClass);

            const common = {
                road_id: roadId,
                road_class: roadClass,
                lanes_total: laneModel.total,
                lane_width_m: laneModel.laneWidthMeters,
                structure_level: structure.structure_level,
            };

            if (coordinates[index - 1]) {
                node.approaches.push({
                    ...common,
                    side: `prev_${index}`,
                    neighbor: coordinates[index - 1],
                });
            }

            if (coordinates[index + 1]) {
                node.approaches.push({
                    ...common,
                    side: `next_${index}`,
                    neighbor: coordinates[index + 1],
                });
            }
        }
    }

    return [...nodes.values()]
        .filter((node) => node.roads.size >= 2 && node.totalLanes >= 5 && node.hasMajorRoad && node.hasTrafficSignal)
        .slice(0, 900);
}

function isCrossingNode(tags) {
    const highway = String(tags.highway ?? '').toLowerCase();
    const crossing = String(tags.crossing ?? '').toLowerCase();

    return highway === 'crossing' || crossing === 'marked' || crossing === 'traffic_signals';
}

function normalizeMaxspeed(value) {
    const match = String(value ?? '').match(/\d+/);

    if (!match) {
        return '';
    }

    const speed = Number.parseInt(match[0], 10);

    if (!Number.isFinite(speed) || speed < 5 || speed > 140) {
        return '';
    }

    return String(speed);
}

function offsetFromCenter(center, eastMeters, northMeters) {
    return offsetCoordinate(offsetCoordinate(center, 90, eastMeters), 0, northMeters);
}

function offsetFromBearingAxes(center, bearing, acrossMeters, alongMeters) {
    return offsetCoordinate(offsetCoordinate(center, bearing + 90, acrossMeters), bearing, alongMeters);
}

function makeLineFeature({ id, coordinates, properties }) {
    return {
        type: 'Feature',
        id,
        properties,
        geometry: {
            type: 'LineString',
            coordinates: coordinates.map(roundCoordinatePair),
        },
    };
}

function getRoadStructure(tags) {
    const explicitLayer = Number.parseInt(tags.layer, 10);
    const hasLayer = Number.isFinite(explicitLayer);
    const isBridge = truthyTag(tags.bridge) || tags.brunnel === 'bridge' || (hasLayer && explicitLayer > 0);
    const isTunnel = truthyTag(tags.tunnel) || tags.brunnel === 'tunnel' || (hasLayer && explicitLayer < 0);
    const level = isBridge ? Math.max(1, hasLayer ? explicitLayer : 1) : isTunnel ? Math.min(-1, hasLayer ? explicitLayer : -1) : 0;

    return {
        structure_level: level,
        is_bridge: isBridge,
        is_tunnel: isTunnel,
    };
}

function truthyTag(value) {
    return ['yes', 'true', '1', 'viaduct', 'aqueduct'].includes(String(value || '').toLowerCase());
}

function getLaneWidthMeters(tags, roadClass, isLink, total) {
    if (isLink) {
        return 3.35;
    }

    const classWidth = {
        motorway: 3.55,
        trunk: 3.5,
        primary: 3.45,
        secondary: 3.35,
        tertiary: 3.25,
    }[roadClass] ?? 3.35;

    const width = Number(tags.width);

    if (!Number.isFinite(width) || width <= 0 || total <= 0) {
        return classWidth;
    }

    const taggedLaneWidth = width / total;

    if (taggedLaneWidth < 2.9 || taggedLaneWidth > 3.9) {
        return classWidth;
    }

    return Math.round(((classWidth * 0.7) + (taggedLaneWidth * 0.3)) * 20) / 20;
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
    const laneWidthMeters = getLaneWidthMeters(tags, roadClass, isLink, total);
    const turns = getTurnLaneValues(tags, total, oneway, forward, backward);
    const busLaneValues = [
        ...getLaneValues(tags['bus:lanes'] ?? tags['psv:lanes'], total),
        ...getLaneValues(tags['bus:lanes:forward'], forward),
        ...getLaneValues(tags['bus:lanes:backward'], backward),
    ];
    const hasExplicitLanes = hasAnyTag(tags, ['lanes', 'lanes:forward', 'lanes:backward']);
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

function getElementCoordinateRefs(element) {
    if (Array.isArray(element.geometry)) {
        return element.geometry.map((point) => String(point.id ?? ''));
    }

    return [];
}

function splitRoadSegments(coordinates, refs, intersectionNodeIds) {
    if (coordinates.length < 2 || !refs.length) {
        return [coordinates];
    }

    const segments = [];
    let current = [coordinates[0]];
    let trimStart = intersectionNodeIds.has(refs[0]);

    for (let index = 1; index < coordinates.length; index += 1) {
        current.push(coordinates[index]);

        const isBreak = intersectionNodeIds.has(refs[index]);

        if (isBreak) {
            const trimmed = trimLine(current, trimStart ? 8 : 0, 8);

            if (trimmed.length >= 2 && lineLengthMeters(trimmed) > 10) {
                segments.push(trimmed);
            }

            current = [coordinates[index]];
            trimStart = true;
        }
    }

    const trimEnd = intersectionNodeIds.has(refs[refs.length - 1]);
    const trimmed = trimLine(current, trimStart ? 8 : 0, trimEnd ? 8 : 0);

    if (trimmed.length >= 2 && lineLengthMeters(trimmed) > 10) {
        segments.push(trimmed);
    }

    return segments.length ? segments : [coordinates];
}

function trimLine(coordinates, startMeters, endMeters) {
    let next = coordinates;

    if (startMeters > 0) {
        next = trimLineStart(next, startMeters);
    }

    if (endMeters > 0) {
        next = trimLineStart([...next].reverse(), endMeters).reverse();
    }

    return next;
}

function trimLineStart(coordinates, meters) {
    if (coordinates.length < 2 || meters <= 0) {
        return coordinates;
    }

    let remaining = meters;

    for (let index = 0; index < coordinates.length - 1; index += 1) {
        const start = coordinates[index];
        const finish = coordinates[index + 1];
        const segmentLength = distanceMeters(start, finish);

        if (segmentLength <= remaining) {
            remaining -= segmentLength;
            continue;
        }

        const ratio = remaining / segmentLength;
        const first = [
            start[0] + ((finish[0] - start[0]) * ratio),
            start[1] + ((finish[1] - start[1]) * ratio),
        ];

        return [first, ...coordinates.slice(index + 1)];
    }

    return [];
}

function lineLengthMeters(coordinates) {
    let total = 0;

    for (let index = 0; index < coordinates.length - 1; index += 1) {
        total += distanceMeters(coordinates[index], coordinates[index + 1]);
    }

    return total;
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

function makeCrossLine(coordinate, roadBearing, widthMeters) {
    const halfWidth = widthMeters / 2;

    return [
        offsetCoordinate(coordinate, roadBearing - 90, halfWidth),
        offsetCoordinate(coordinate, roadBearing + 90, halfWidth),
    ];
}

function offsetPointAtRatio(coordinates, ratio, offsetMeters = 0) {
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

function offsetLineString(coordinates, offsetMeters = 0) {
    const distance = Number(offsetMeters) || 0;

    if (!distance || coordinates.length < 2) {
        return coordinates;
    }

    return coordinates.map((coordinate, index) => {
        const previous = coordinates[index - 1] ?? coordinate;
        const next = coordinates[index + 1] ?? coordinate;
        const start = previous === coordinate ? coordinate : previous;
        const finish = next === coordinate ? coordinate : next;
        const bearing = getBearing(start, finish);

        return offsetCoordinate(coordinate, bearing + 90, distance);
    });
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

function bboxToObject(value) {
    if (!value) {
        return null;
    }

    return {
        south: value[0],
        west: value[1],
        north: value[2],
        east: value[3],
    };
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

function roundCoordinatePair(coordinate) {
    return [
        roundCoordinate(coordinate[0]),
        roundCoordinate(coordinate[1]),
    ];
}

function toRadians(value) {
    return Number(value) * Math.PI / 180;
}

function toDegrees(value) {
    return Number(value) * 180 / Math.PI;
}
