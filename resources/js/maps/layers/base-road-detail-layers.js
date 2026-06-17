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
const MARKING_COLOR = '#E8EEF5';
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
    0.82,
    'primary',
    0.52,
    'secondary',
    0.34,
    'tertiary',
    0.2,
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
    ['*', 19, motorwayMergeWidthFactor],
    15,
    ['*', 32, motorwayMergeWidthFactor],
    16,
    ['*', 54, motorwayMergeWidthFactor],
    17,
    ['*', 80, motorwayMergeWidthFactor],
    18,
    ['*', 116, motorwayMergeWidthFactor],
    19,
    ['*', 164, motorwayMergeWidthFactor],
    20,
    ['*', 226, motorwayMergeWidthFactor],
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
const roadDividerMarkingWidth = ['interpolate', ['linear'], ['zoom'], 17, 0.45, 18.5, 0.85, 20, 1.25];
const busLaneWidth = ['interpolate', ['linear'], ['zoom'], 18, 1.1, 20, 2.4];

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

    return layer;
}

export function createBaseRoadDetailLayers({ source, sourceLayer = 'transportation' }) {
    const majorFilter = ['all', majorRoadClassFilter, ['!', linkRoadFilter]];

    return [
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
            id: 'base_road_major_surface',
            source,
            sourceLayer,
            filter: majorFilter,
            minzoom: 14,
            color: ASPHALT_COLOR,
            width: majorSurfaceWidth,
        }),
        roadLineLayer({
            id: 'base_road_edge_markings',
            source,
            sourceLayer,
            filter: roadClassFilter,
            minzoom: 17.4,
            color: MARKING_COLOR,
            width: roadEdgeMarkingWidth,
            opacity: 0.2,
        }),
        roadLineLayer({
            id: 'base_road_lane_dividers',
            source,
            sourceLayer,
            filter: majorFilter,
            minzoom: 17.8,
            color: MARKING_COLOR,
            width: roadDividerMarkingWidth,
            opacity: 0.3,
            dasharray: [2.6, 3.4],
        }),
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
    ];
}
