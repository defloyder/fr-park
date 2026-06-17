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
const MARKING_COLOR = '#F8FAFC';
const LANE_MARKING_COLOR = '#EEF4FA';
const CENTER_MARKING_COLOR = '#FFFFFF';
const BUS_LANE_COLOR = '#7DD3FC';

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
    ['*', 76, roadWidthFactor],
    18,
    ['*', 118, roadWidthFactor],
    19,
    ['*', 176, roadWidthFactor],
    20,
    ['*', 252, roadWidthFactor],
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

const roadEdgeMarkingWidth = ['interpolate', ['linear'], ['zoom'], 16.8, 1.1, 18.5, 1.9, 20, 2.65];
const roadDividerMarkingWidth = ['interpolate', ['linear'], ['zoom'], 16.8, 1.05, 18.5, 1.8, 20, 2.5];
const roadCenterMarkingWidth = ['interpolate', ['linear'], ['zoom'], 16.8, 1.35, 18.5, 2.25, 20, 3.05];
const busLaneWidth = ['interpolate', ['linear'], ['zoom'], 17.6, 2.6, 19, 4.2, 20, 5.4];
const majorSeamWidth = [
    'interpolate',
    ['linear'],
    ['zoom'],
    14,
    ['*', 12.96, roadWidthFactor],
    15,
    ['*', 21.6, roadWidthFactor],
    16,
    ['*', 36.72, roadWidthFactor],
    17,
    ['*', 54, roadWidthFactor],
    18,
    ['*', 75.6, roadWidthFactor],
    19,
    ['*', 103.68, roadWidthFactor],
    20,
    ['*', 142.56, roadWidthFactor],
];

const minorSeamWidth = [
    'interpolate',
    ['linear'],
    ['zoom'],
    15,
    5.3,
    16,
    8.48,
    17,
    12.72,
    18,
    18.02,
    19,
    25.44,
    20,
    36.04,
];

const rampSeamWidth = [
    'interpolate',
    ['linear'],
    ['zoom'],
    15,
    ['*', 10.6, rampWidthFactor],
    16,
    ['*', 18.02, rampWidthFactor],
    17,
    ['*', 27.56, rampWidthFactor],
    18,
    ['*', 40.28, rampWidthFactor],
    19,
    ['*', 57.24, rampWidthFactor],
    20,
    ['*', 78.44, rampWidthFactor],
];
const centerDoubleOffset = ['interpolate', ['linear'], ['zoom'], 17, 1.1, 18.5, 1.9, 20, 2.8];
const centerDoubleOffsetNegative = ['interpolate', ['linear'], ['zoom'], 17, -1.1, 18.5, -1.9, 20, -2.8];
const majorEdgeOffset = [
    'interpolate',
    ['linear'],
    ['zoom'],
    17,
    ['*', 24, roadWidthFactor],
    18,
    ['*', 34, roadWidthFactor],
    19,
    ['*', 47, roadWidthFactor],
    20,
    ['*', 64, roadWidthFactor],
];
const majorEdgeOffsetNegative = [
    'interpolate',
    ['linear'],
    ['zoom'],
    17,
    ['*', -24, roadWidthFactor],
    18,
    ['*', -34, roadWidthFactor],
    19,
    ['*', -47, roadWidthFactor],
    20,
    ['*', -64, roadWidthFactor],
];
const rampEdgeOffset = [
    'interpolate',
    ['linear'],
    ['zoom'],
    17,
    ['*', 13, rampWidthFactor],
    18,
    ['*', 19, rampWidthFactor],
    19,
    ['*', 27, rampWidthFactor],
    20,
    ['*', 37, rampWidthFactor],
];
const rampEdgeOffsetNegative = [
    'interpolate',
    ['linear'],
    ['zoom'],
    17,
    ['*', -13, rampWidthFactor],
    18,
    ['*', -19, rampWidthFactor],
    19,
    ['*', -27, rampWidthFactor],
    20,
    ['*', -37, rampWidthFactor],
];
const minorEdgeOffset = ['interpolate', ['linear'], ['zoom'], 17, 5, 18, 7, 19, 10, 20, 14];
const minorEdgeOffsetNegative = ['interpolate', ['linear'], ['zoom'], 17, -5, 18, -7, 19, -10, 20, -14];

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
    cap = 'round',
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

function laneCountFilter(laneCount) {
    return ['==', laneCountExpression, laneCount];
}

function laneDividerOffset(laneCount, dividerIndex) {
    const factor = dividerIndex - laneCount / 2;

    return [
        'interpolate',
        ['linear'],
        ['zoom'],
        17,
        5.2 * factor,
        18,
        7.6 * factor,
        19,
        10.4 * factor,
        20,
        13.6 * factor,
    ];
}

function createLaneDividerLayers({ source, sourceLayer, filter }) {
    const layers = [];

    for (let laneCount = 2; laneCount <= 8; laneCount += 1) {
        for (let dividerIndex = 1; dividerIndex < laneCount; dividerIndex += 1) {
            layers.push(roadLineLayer({
                id: `base_road_lane_marking_${laneCount}_${dividerIndex}`,
                source,
                sourceLayer,
                filter: ['all', filter, laneCountFilter(laneCount)],
                minzoom: 17.2,
                color: LANE_MARKING_COLOR,
                width: roadDividerMarkingWidth,
                opacity: ['interpolate', ['linear'], ['zoom'], 17.2, 0.62, 18.5, 0.86, 20, 0.94],
                dasharray: [3.4, 2.7],
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
            minzoom: 17,
            color: CENTER_MARKING_COLOR,
            width: roadCenterMarkingWidth,
            opacity: ['interpolate', ['linear'], ['zoom'], 17, 0.7, 18.5, 0.92, 20, 0.98],
            offset: centerDoubleOffsetNegative,
        }),
        roadLineLayer({
            id: 'base_road_center_double_right',
            source,
            sourceLayer,
            filter: ['all', filter, ['!', onewayFilter], ['>=', laneCountExpression, 3]],
            minzoom: 17,
            color: CENTER_MARKING_COLOR,
            width: roadCenterMarkingWidth,
            opacity: ['interpolate', ['linear'], ['zoom'], 17, 0.7, 18.5, 0.92, 20, 0.98],
            offset: centerDoubleOffset,
        }),
        roadLineLayer({
            id: 'base_road_center_dashed',
            source,
            sourceLayer,
            filter: ['all', filter, ['!', onewayFilter], ['<', laneCountExpression, 3]],
            minzoom: 17.3,
            color: CENTER_MARKING_COLOR,
            width: roadDividerMarkingWidth,
            opacity: ['interpolate', ['linear'], ['zoom'], 17.3, 0.64, 18.5, 0.86, 20, 0.94],
            dasharray: [3.5, 2.8],
        }),
    ];
}

function createRoadEdgeMarkingLayers({ source, sourceLayer, idPrefix, filter, negativeOffset, positiveOffset }) {
    return [
        roadLineLayer({
            id: `${idPrefix}_edge_left`,
            source,
            sourceLayer,
            filter,
            minzoom: 16.8,
            color: MARKING_COLOR,
            width: roadEdgeMarkingWidth,
            opacity: ['interpolate', ['linear'], ['zoom'], 16.8, 0.52, 18.5, 0.82, 20, 0.92],
            offset: negativeOffset,
        }),
        roadLineLayer({
            id: `${idPrefix}_edge_right`,
            source,
            sourceLayer,
            filter,
            minzoom: 16.8,
            color: MARKING_COLOR,
            width: roadEdgeMarkingWidth,
            opacity: ['interpolate', ['linear'], ['zoom'], 16.8, 0.52, 18.5, 0.82, 20, 0.92],
            offset: positiveOffset,
        }),
    ];
}

export function createBaseRoadDetailLayers({ source, sourceLayer = 'transportation', includeMarkings = false }) {
    const majorFilter = ['all', majorRoadClassFilter, ['!', linkRoadFilter]];
    const surfaceLayers = [
        roadLineLayer({
            id: 'base_road_minor_seam_fill',
            source,
            sourceLayer,
            filter: minorRoadClassFilter,
            minzoom: 15.2,
            color: ASPHALT_COLOR,
            width: minorSeamWidth,
            cap: 'round',
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
            cap: 'round',
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
            cap: 'round',
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
    ];

    if (!includeMarkings) {
        return surfaceLayers;
    }

    return [
        ...surfaceLayers,
        ...createRoadEdgeMarkingLayers({
            source,
            sourceLayer,
            idPrefix: 'base_road_minor',
            filter: minorRoadClassFilter,
            negativeOffset: minorEdgeOffsetNegative,
            positiveOffset: minorEdgeOffset,
        }),
        ...createRoadEdgeMarkingLayers({
            source,
            sourceLayer,
            idPrefix: 'base_road_ramp',
            filter: linkRoadFilter,
            negativeOffset: rampEdgeOffsetNegative,
            positiveOffset: rampEdgeOffset,
        }),
        ...createRoadEdgeMarkingLayers({
            source,
            sourceLayer,
            idPrefix: 'base_road_major',
            filter: majorFilter,
            negativeOffset: majorEdgeOffsetNegative,
            positiveOffset: majorEdgeOffset,
        }),
        ...createTwoWayLaneDividerLayers({
            source,
            sourceLayer,
            filter: majorFilter,
        }),
        ...createLaneDividerLayers({
            source,
            sourceLayer,
            filter: majorFilter,
        }),
        roadLineLayer({
            id: 'base_road_bus_lanes',
            source,
            sourceLayer,
            filter: busLaneFilter,
            minzoom: 17.6,
            color: BUS_LANE_COLOR,
            width: busLaneWidth,
            opacity: ['interpolate', ['linear'], ['zoom'], 17.6, 0.36, 19, 0.58, 20, 0.68],
        }),
    ];
}
