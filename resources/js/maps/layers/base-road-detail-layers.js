const ROAD_CLASSES = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor', 'service'];
const MAJOR_ROAD_CLASSES = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary'];
const MINOR_ROAD_CLASSES = ['minor', 'service'];
const LINK_ROAD_CLASSES = ['motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link'];

const roadClassFilter = ['in', ['get', 'class'], ['literal', ROAD_CLASSES]];
const majorRoadClassFilter = ['in', ['get', 'class'], ['literal', MAJOR_ROAD_CLASSES]];
const minorRoadClassFilter = ['in', ['get', 'class'], ['literal', MINOR_ROAD_CLASSES]];
const linkRoadFilter = [
    'any',
    ['in', ['get', 'class'], ['literal', LINK_ROAD_CLASSES]],
    ['in', ['get', 'subclass'], ['literal', LINK_ROAD_CLASSES]],
    ['==', ['get', 'ramp'], 1],
    ['==', ['get', 'ramp'], true],
];
const bridgeFilter = [
    'any',
    ['==', ['get', 'brunnel'], 'bridge'],
    ['==', ['get', 'bridge'], true],
    ['>', ['coalesce', ['to-number', ['get', 'layer']], 0], 0],
];
const tunnelFilter = [
    'any',
    ['==', ['get', 'brunnel'], 'tunnel'],
    ['==', ['get', 'tunnel'], true],
    ['<', ['coalesce', ['to-number', ['get', 'layer']], 0], 0],
];

const ASPHALT_COLOR = '#8A9AAB';
const ELEVATED_ASPHALT_COLOR = '#91A0B0';
const ELEVATED_SIDE_COLOR = '#7D8D9F';
const ELEVATED_SHADOW_COLOR = '#0B1421';
const MARKING_COLOR = '#E8EEF5';
const LANE_MARKING_COLOR = '#D7E0EA';
const CENTER_MARKING_COLOR = '#F1F5FA';
const BUS_LANE_COLOR = '#78B8C9';

const roadWidthFactor = [
    'match',
    ['get', 'class'],
    'motorway',
    1,
    'trunk',
    0.94,
    'primary',
    0.84,
    'secondary',
    0.72,
    'tertiary',
    0.62,
    'minor',
    0.42,
    'service',
    0.32,
    0.5,
];

const motorwayMergeWidthFactor = [
    'match',
    ['get', 'class'],
    'motorway',
    1,
    'trunk',
    0.96,
    'primary',
    0.82,
    'secondary',
    0.56,
    'tertiary',
    0.36,
    0,
];

const rampWidthFactor = [
    'match',
    ['get', 'class'],
    'motorway',
    0.62,
    'trunk',
    0.58,
    'primary',
    0.52,
    'secondary',
    0.48,
    0.42,
];

const motorwayMainlineFilter = [
    'all',
    ['in', ['get', 'class'], ['literal', ['motorway', 'trunk', 'primary']]],
    ['!', linkRoadFilter],
];

const onewayFilter = [
    'any',
    ['==', ['get', 'oneway'], 1],
    ['==', ['get', 'oneway'], true],
    ['==', ['get', 'oneway'], 'yes'],
];

const busLaneFilter = [
    'any',
    ['==', ['get', 'busway'], 'lane'],
    ['==', ['get', 'busway:left'], 'lane'],
    ['==', ['get', 'busway:right'], 'lane'],
    ['==', ['get', 'bus:lanes'], 'designated'],
    ['in', ['get', 'class'], ['literal', ['busway']]],
];

const majorSurfaceWidth = [
    'interpolate',
    ['linear'],
    ['zoom'],
    14,
    ['*', 12, roadWidthFactor],
    15,
    ['*', 20, roadWidthFactor],
    16,
    ['*', 34, roadWidthFactor],
    17,
    ['*', 50, roadWidthFactor],
    18,
    ['*', 70, roadWidthFactor],
    19,
    ['*', 96, roadWidthFactor],
    20,
    ['*', 132, roadWidthFactor],
];

const majorUnifierWidth = [
    'interpolate',
    ['linear'],
    ['zoom'],
    14,
    ['*', 16, roadWidthFactor],
    15,
    ['*', 27, roadWidthFactor],
    16,
    ['*', 44, roadWidthFactor],
    17,
    ['*', 66, roadWidthFactor],
    18,
    ['*', 92, roadWidthFactor],
    19,
    ['*', 128, roadWidthFactor],
    20,
    ['*', 176, roadWidthFactor],
];

const motorwayMedianFillWidth = [
    'interpolate',
    ['linear'],
    ['zoom'],
    14,
    ['*', 22, motorwayMergeWidthFactor],
    15,
    ['*', 38, motorwayMergeWidthFactor],
    16,
    ['*', 66, motorwayMergeWidthFactor],
    17,
    ['*', 98, motorwayMergeWidthFactor],
    18,
    ['*', 142, motorwayMergeWidthFactor],
    19,
    ['*', 204, motorwayMergeWidthFactor],
    20,
    ['*', 284, motorwayMergeWidthFactor],
];

const bridgeShadowWidth = [
    'interpolate',
    ['linear'],
    ['zoom'],
    14,
    ['+', ['*', 13, roadWidthFactor], 2],
    16,
    ['+', ['*', 37, roadWidthFactor], 4],
    18,
    ['+', ['*', 76, roadWidthFactor], 6],
    20,
    ['+', ['*', 140, roadWidthFactor], 9],
];

const bridgeSideWidth = [
    'interpolate',
    ['linear'],
    ['zoom'],
    14,
    ['+', ['*', 12, roadWidthFactor], 1],
    16,
    ['+', ['*', 35, roadWidthFactor], 2],
    18,
    ['+', ['*', 72, roadWidthFactor], 4],
    20,
    ['+', ['*', 136, roadWidthFactor], 6],
];

const bridgeSurfaceWidth = [
    'interpolate',
    ['linear'],
    ['zoom'],
    14,
    ['*', 12, roadWidthFactor],
    16,
    ['*', 35, roadWidthFactor],
    18,
    ['*', 72, roadWidthFactor],
    20,
    ['*', 136, roadWidthFactor],
];

const minorSurfaceWidth = [
    'interpolate',
    ['linear'],
    ['zoom'],
    15,
    5,
    16,
    8,
    17,
    12,
    18,
    17,
    19,
    24,
    20,
    34,
];

const rampSurfaceWidth = [
    'interpolate',
    ['linear'],
    ['zoom'],
    15,
    ['*', 10, rampWidthFactor],
    16,
    ['*', 17, rampWidthFactor],
    17,
    ['*', 26, rampWidthFactor],
    18,
    ['*', 38, rampWidthFactor],
    19,
    ['*', 54, rampWidthFactor],
    20,
    ['*', 74, rampWidthFactor],
];

const roadEdgeMarkingWidth = ['interpolate', ['linear'], ['zoom'], 17, 0.35, 18.5, 0.7, 20, 1.05];
const roadDividerMarkingWidth = ['interpolate', ['linear'], ['zoom'], 17, 0.34, 18.5, 0.66, 20, 0.95];
const roadCenterMarkingWidth = ['interpolate', ['linear'], ['zoom'], 17, 0.55, 18.5, 1.05, 20, 1.55];
const busLaneWidth = ['interpolate', ['linear'], ['zoom'], 18, 1.1, 20, 2.4];
const bridgeHighlightWidth = ['interpolate', ['linear'], ['zoom'], 15, 0.8, 18, 1.4, 20, 2];
const majorSeamWidth = ['*', majorSurfaceWidth, 0.96];
const minorSeamWidth = ['*', minorSurfaceWidth, 0.92];
const rampSeamWidth = ['*', rampSurfaceWidth, 0.92];
const bridgeSeamWidth = ['*', bridgeSurfaceWidth, 0.96];
const lanePixelWidth = ['interpolate', ['linear'], ['zoom'], 17, 4.2, 18, 6.2, 19, 8.6, 20, 11.4];
const centerDoubleOffset = ['interpolate', ['linear'], ['zoom'], 17, 1.1, 18.5, 1.9, 20, 2.8];
const majorEdgeOffset = ['*', majorSurfaceWidth, 0.45];
const rampEdgeOffset = ['*', rampSurfaceWidth, 0.42];
const minorEdgeOffset = ['*', minorSurfaceWidth, 0.4];

const defaultLaneCount = [
    'case',
    linkRoadFilter,
    1,
    ['==', ['get', 'class'], 'motorway'],
    4,
    ['==', ['get', 'class'], 'trunk'],
    4,
    ['==', ['get', 'class'], 'primary'],
    3,
    ['==', ['get', 'class'], 'secondary'],
    2,
    ['==', ['get', 'class'], 'tertiary'],
    2,
    1,
];

const laneCountExpression = [
    'min',
    8,
    ['max', 1, ['coalesce', ['to-number', ['get', 'lanes']], defaultLaneCount]],
];

function roadLineLayer({
    id,
    source,
    sourceLayer,
    filter,
    minzoom,
    color,
    width,
    opacity = 1,
    cap = 'butt',
    dasharray = null,
    blur = null,
    offset = null,
    translate = null,
    translateAnchor = null,
}) {
    const layer = {
        id,
        type: 'line',
        source,
        'source-layer': sourceLayer,
        filter,
        minzoom,
        layout: {
            'line-cap': cap,
            'line-join': 'round',
        },
        paint: {
            'line-color': color,
            'line-width': width,
            'line-opacity': opacity,
        },
    };

    if (dasharray) {
        layer.paint['line-dasharray'] = dasharray;
    }

    if (blur !== null) {
        layer.paint['line-blur'] = blur;
    }

    if (offset !== null) {
        layer.paint['line-offset'] = offset;
    }

    if (translate) {
        layer.paint['line-translate'] = translate;
    }

    if (translateAnchor) {
        layer.paint['line-translate-anchor'] = translateAnchor;
    }

    return layer;
}

function roadArrowSymbolLayer({
    id,
    source,
    sourceLayer,
    filter,
    minzoom,
    size,
    opacity = 1,
    spacing = 140,
}) {
    return {
        id,
        type: 'symbol',
        source,
        'source-layer': sourceLayer,
        filter,
        minzoom,
        layout: {
            'symbol-placement': 'line',
            'symbol-spacing': spacing,
            'icon-image': 'road-marking-arrow-through',
            'icon-size': size,
            'icon-rotation-alignment': 'map',
            'icon-pitch-alignment': 'map',
            'icon-keep-upright': false,
            'icon-allow-overlap': false,
            'icon-ignore-placement': false,
        },
        paint: {
            'icon-opacity': opacity,
        },
    };
}

function laneCountFilter(laneCount) {
    return ['==', laneCountExpression, laneCount];
}

function laneDividerOffset(laneCount, dividerIndex) {
    return ['*', lanePixelWidth, dividerIndex - laneCount / 2];
}

function createLaneDividerLayers({ source, sourceLayer, filter }) {
    const layers = [];

    for (let laneCount = 2; laneCount <= 8; laneCount += 1) {
        for (let dividerIndex = 1; dividerIndex < laneCount; dividerIndex += 1) {
            layers.push(roadLineLayer({
                id: `base_road_lane_marking_${laneCount}_${dividerIndex}`,
                source,
                sourceLayer,
                filter: ['all', filter, laneCountFilter(laneCount), onewayFilter],
                minzoom: 17.6,
                color: LANE_MARKING_COLOR,
                width: roadDividerMarkingWidth,
                opacity: ['interpolate', ['linear'], ['zoom'], 17.6, 0.24, 19, 0.52, 20, 0.62],
                dasharray: [2.1, 3.2],
                offset: laneDividerOffset(laneCount, dividerIndex),
            }));
        }
    }

    return layers;
}

function createTwoWayLaneDividerLayers({ source, sourceLayer, filter }) {
    return [
        roadLineLayer({
            id: 'base_road_center_double_left',
            source,
            sourceLayer,
            filter: ['all', filter, ['!', onewayFilter], ['>=', laneCountExpression, 3]],
            minzoom: 17.5,
            color: CENTER_MARKING_COLOR,
            width: roadCenterMarkingWidth,
            opacity: ['interpolate', ['linear'], ['zoom'], 17.5, 0.28, 19, 0.56, 20, 0.68],
            offset: ['*', centerDoubleOffset, -1],
        }),
        roadLineLayer({
            id: 'base_road_center_double_right',
            source,
            sourceLayer,
            filter: ['all', filter, ['!', onewayFilter], ['>=', laneCountExpression, 3]],
            minzoom: 17.5,
            color: CENTER_MARKING_COLOR,
            width: roadCenterMarkingWidth,
            opacity: ['interpolate', ['linear'], ['zoom'], 17.5, 0.28, 19, 0.56, 20, 0.68],
            offset: centerDoubleOffset,
        }),
        roadLineLayer({
            id: 'base_road_center_dashed',
            source,
            sourceLayer,
            filter: ['all', filter, ['!', onewayFilter], ['<', laneCountExpression, 3]],
            minzoom: 17.8,
            color: CENTER_MARKING_COLOR,
            width: roadDividerMarkingWidth,
            opacity: ['interpolate', ['linear'], ['zoom'], 17.8, 0.28, 19, 0.52, 20, 0.62],
            dasharray: [2.4, 3.4],
        }),
    ];
}

function createRoadEdgeMarkingLayers({ source, sourceLayer, idPrefix, filter, offset }) {
    return [
        roadLineLayer({
            id: `${idPrefix}_edge_left`,
            source,
            sourceLayer,
            filter,
            minzoom: 17.2,
            color: MARKING_COLOR,
            width: roadEdgeMarkingWidth,
            opacity: ['interpolate', ['linear'], ['zoom'], 17.2, 0.16, 19, 0.38, 20, 0.46],
            offset: ['*', offset, -1],
        }),
        roadLineLayer({
            id: `${idPrefix}_edge_right`,
            source,
            sourceLayer,
            filter,
            minzoom: 17.2,
            color: MARKING_COLOR,
            width: roadEdgeMarkingWidth,
            opacity: ['interpolate', ['linear'], ['zoom'], 17.2, 0.16, 19, 0.38, 20, 0.46],
            offset,
        }),
    ];
}

export function createBaseRoadDetailLayers({ source, sourceLayer = 'transportation' }) {
    const majorFilter = ['all', majorRoadClassFilter, ['!', linkRoadFilter]];
    const nonBridgeMajorFilter = ['all', majorFilter, ['!', bridgeFilter]];
    const bridgeRoadFilter = ['all', roadClassFilter, bridgeFilter, ['!', tunnelFilter]];
    const bridgeMajorFilter = ['all', majorRoadClassFilter, bridgeFilter, ['!', linkRoadFilter], ['!', tunnelFilter]];

    return [
        roadLineLayer({
            id: 'base_road_minor_seam_fill',
            source,
            sourceLayer,
            filter: minorRoadClassFilter,
            minzoom: 15.2,
            color: ASPHALT_COLOR,
            width: minorSeamWidth,
            cap: 'square',
        }),
        roadLineLayer({
            id: 'base_road_minor_surface',
            source,
            sourceLayer,
            filter: minorRoadClassFilter,
            minzoom: 15.2,
            color: ASPHALT_COLOR,
            width: minorSurfaceWidth,
        }),
        roadLineLayer({
            id: 'base_road_ramp_seam_fill',
            source,
            sourceLayer,
            filter: linkRoadFilter,
            minzoom: 14.8,
            color: ASPHALT_COLOR,
            width: rampSeamWidth,
            cap: 'square',
        }),
        roadLineLayer({
            id: 'base_road_ramp_surface',
            source,
            sourceLayer,
            filter: linkRoadFilter,
            minzoom: 14.8,
            color: ASPHALT_COLOR,
            width: rampSurfaceWidth,
        }),
        roadLineLayer({
            id: 'base_road_motorway_median_fill',
            source,
            sourceLayer,
            filter: motorwayMainlineFilter,
            minzoom: 14,
            color: ASPHALT_COLOR,
            width: motorwayMedianFillWidth,
        }),
        roadLineLayer({
            id: 'base_road_major_unifier',
            source,
            sourceLayer,
            filter: majorFilter,
            minzoom: 14,
            color: ASPHALT_COLOR,
            width: majorUnifierWidth,
        }),
        roadLineLayer({
            id: 'base_road_major_seam_fill',
            source,
            sourceLayer,
            filter: majorFilter,
            minzoom: 14,
            color: ASPHALT_COLOR,
            width: majorSeamWidth,
            cap: 'square',
        }),
        roadLineLayer({
            id: 'base_road_major_surface',
            source,
            sourceLayer,
            filter: majorFilter,
            minzoom: 14,
            color: ASPHALT_COLOR,
            width: majorSurfaceWidth,
        }),
        roadLineLayer({
            id: 'base_road_bridge_shadow',
            source,
            sourceLayer,
            filter: bridgeRoadFilter,
            minzoom: 14,
            color: ELEVATED_SHADOW_COLOR,
            width: bridgeShadowWidth,
            opacity: 0.14,
            blur: ['interpolate', ['linear'], ['zoom'], 14, 0.8, 18, 1.6, 20, 2.2],
            translate: [1, 2],
            translateAnchor: 'viewport',
        }),
        roadLineLayer({
            id: 'base_road_bridge_surface',
            source,
            sourceLayer,
            filter: bridgeRoadFilter,
            minzoom: 14,
            color: ELEVATED_ASPHALT_COLOR,
            width: bridgeSurfaceWidth,
        }),
        ...createRoadEdgeMarkingLayers({
            source,
            sourceLayer,
            idPrefix: 'base_road_minor',
            filter: minorRoadClassFilter,
            offset: minorEdgeOffset,
        }),
        ...createRoadEdgeMarkingLayers({
            source,
            sourceLayer,
            idPrefix: 'base_road_ramp',
            filter: linkRoadFilter,
            offset: rampEdgeOffset,
        }),
        ...createRoadEdgeMarkingLayers({
            source,
            sourceLayer,
            idPrefix: 'base_road_major',
            filter: majorFilter,
            offset: majorEdgeOffset,
        }),
        ...createTwoWayLaneDividerLayers({
            source,
            sourceLayer,
            filter: nonBridgeMajorFilter,
        }),
        ...createTwoWayLaneDividerLayers({
            source,
            sourceLayer,
            filter: bridgeMajorFilter,
        }).map((layer) => ({
            ...layer,
            id: layer.id.replace('base_road_center', 'base_road_bridge_center'),
            paint: {
                ...layer.paint,
                'line-opacity': ['interpolate', ['linear'], ['zoom'], 17.5, 0.32, 19, 0.62, 20, 0.72],
            },
        })),
        ...createLaneDividerLayers({
            source,
            sourceLayer,
            filter: nonBridgeMajorFilter,
        }),
        ...createLaneDividerLayers({
            source,
            sourceLayer,
            filter: bridgeMajorFilter,
        }).map((layer) => ({
            ...layer,
            id: layer.id.replace('base_road_lane_marking', 'base_road_bridge_lane_marking'),
            paint: {
                ...layer.paint,
                'line-opacity': ['interpolate', ['linear'], ['zoom'], 17.6, 0.28, 19, 0.6, 20, 0.7],
            },
        })),
        roadLineLayer({
            id: 'base_road_bus_lanes',
            source,
            sourceLayer,
            filter: busLaneFilter,
            minzoom: 18.2,
            color: BUS_LANE_COLOR,
            width: busLaneWidth,
            opacity: 0.28,
        }),
        roadArrowSymbolLayer({
            id: 'base_road_direction_arrows',
            source,
            sourceLayer,
            filter: ['all', nonBridgeMajorFilter, onewayFilter],
            minzoom: 18.2,
            size: ['interpolate', ['linear'], ['zoom'], 18.2, 0.26, 20, 0.42],
            opacity: ['interpolate', ['linear'], ['zoom'], 18.2, 0.24, 20, 0.48],
            spacing: 220,
        }),
        roadArrowSymbolLayer({
            id: 'base_road_ramp_direction_arrows',
            source,
            sourceLayer,
            filter: linkRoadFilter,
            minzoom: 18,
            size: ['interpolate', ['linear'], ['zoom'], 18, 0.22, 20, 0.34],
            opacity: ['interpolate', ['linear'], ['zoom'], 18, 0.28, 20, 0.54],
            spacing: 150,
        }),
    ];
}
