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

const rampWidthFactor = [
    'match',
    ['get', 'class'],
    'motorway',
    0.54,
    'trunk',
    0.5,
    'primary',
    0.46,
    'secondary',
    0.42,
    0.38,
];

const detailOpacity = (start, mid, end) => [
    'interpolate',
    ['linear'],
    ['zoom'],
    15,
    start,
    16.5,
    mid,
    18,
    end,
];

const majorSurfaceWidth = [
    'interpolate',
    ['linear'],
    ['zoom'],
    14,
    ['*', 11, roadWidthFactor],
    15,
    ['*', 19, roadWidthFactor],
    16,
    ['*', 31, roadWidthFactor],
    17,
    ['*', 47, roadWidthFactor],
    18,
    ['*', 68, roadWidthFactor],
    19,
    ['*', 96, roadWidthFactor],
    20,
    ['*', 132, roadWidthFactor],
];

const majorCasingWidth = [
    'interpolate',
    ['linear'],
    ['zoom'],
    14,
    ['*', 14, roadWidthFactor],
    15,
    ['*', 23, roadWidthFactor],
    16,
    ['*', 37, roadWidthFactor],
    17,
    ['*', 54, roadWidthFactor],
    18,
    ['*', 78, roadWidthFactor],
    19,
    ['*', 110, roadWidthFactor],
    20,
    ['*', 150, roadWidthFactor],
];

const majorCorridorWidth = [
    'interpolate',
    ['linear'],
    ['zoom'],
    14,
    ['*', 19, roadWidthFactor],
    15,
    ['*', 32, roadWidthFactor],
    16,
    ['*', 52, roadWidthFactor],
    17,
    ['*', 76, roadWidthFactor],
    18,
    ['*', 110, roadWidthFactor],
    19,
    ['*', 154, roadWidthFactor],
    20,
    ['*', 210, roadWidthFactor],
];

const minorSurfaceWidth = [
    'interpolate',
    ['linear'],
    ['zoom'],
    15,
    6,
    16,
    10,
    17,
    15,
    18,
    22,
    19,
    31,
    20,
    42,
];

const rampSurfaceWidth = [
    'interpolate',
    ['linear'],
    ['zoom'],
    15,
    ['*', 10, rampWidthFactor],
    16,
    ['*', 16, rampWidthFactor],
    17,
    ['*', 25, rampWidthFactor],
    18,
    ['*', 38, rampWidthFactor],
    19,
    ['*', 54, rampWidthFactor],
    20,
    ['*', 72, rampWidthFactor],
];

const edgeOffset = [
    'interpolate',
    ['linear'],
    ['zoom'],
    16,
    ['*', 15, roadWidthFactor],
    17,
    ['*', 23, roadWidthFactor],
    18,
    ['*', 34, roadWidthFactor],
    19,
    ['*', 48, roadWidthFactor],
    20,
    ['*', 65, roadWidthFactor],
];

const rampEdgeOffset = [
    'interpolate',
    ['linear'],
    ['zoom'],
    16,
    ['*', 5, rampWidthFactor],
    17,
    ['*', 8, rampWidthFactor],
    18,
    ['*', 12, rampWidthFactor],
    19,
    ['*', 17, rampWidthFactor],
    20,
    ['*', 24, rampWidthFactor],
];

const guideOffset = (direction) => [
    '*',
    direction,
    [
        'interpolate',
        ['linear'],
        ['zoom'],
        17,
        8,
        18,
        12,
        19,
        17,
        20,
        24,
    ],
];

const laneGuideWidth = ['interpolate', ['linear'], ['zoom'], 17, 0.8, 18, 1.2, 19, 1.55, 20, 2];
const laneGuideOpacity = ['interpolate', ['linear'], ['zoom'], 17, 0.28, 18, 0.58, 19, 0.72, 20, 0.78];
const secondaryLaneGuideOpacity = ['interpolate', ['linear'], ['zoom'], 17.8, 0.06, 18.5, 0.36, 20, 0.52];
const rampLaneGuideOpacity = ['interpolate', ['linear'], ['zoom'], 17.2, 0.22, 18, 0.46, 20, 0.62];

function laneGuideLayer({ id, source, sourceLayer, filter, offset, minzoom = 17, opacity = laneGuideOpacity }) {
    return {
        id,
        type: 'line',
        source,
        'source-layer': sourceLayer,
        filter,
        minzoom,
        layout: {
            'line-cap': 'butt',
            'line-join': 'round',
        },
        paint: {
            'line-color': '#F7FBFF',
            'line-width': laneGuideWidth,
            'line-opacity': opacity,
            'line-offset': guideOffset(offset),
            'line-dasharray': [3.8, 3.1],
        },
    };
}

export function createBaseRoadDetailLayers({ source, sourceLayer = 'transportation' }) {
    const majorCarriagewayFilter = ['all', majorRoadClassFilter, ['!', linkRoadFilter]];

    return [
        {
            id: 'base_road_bridge_shadow',
            type: 'line',
            source,
            'source-layer': sourceLayer,
            filter: ['all', roadClassFilter, bridgeFilter],
            minzoom: 14.5,
            layout: {
                'line-cap': 'butt',
                'line-join': 'round',
            },
            paint: {
                'line-color': 'rgba(4, 10, 20, 0.66)',
                'line-width': ['interpolate', ['linear'], ['zoom'], 14.5, 5, 17, 13, 19, 24],
                'line-translate': [0, 5],
                'line-translate-anchor': 'viewport',
                'line-blur': 4,
                'line-opacity': detailOpacity(0.22, 0.32, 0.42),
            },
        },
        {
            id: 'base_road_tunnel_glow',
            type: 'line',
            source,
            'source-layer': sourceLayer,
            filter: ['all', majorRoadClassFilter, tunnelFilter],
            minzoom: 14.5,
            layout: {
                'line-cap': 'butt',
                'line-join': 'round',
            },
            paint: {
                'line-color': '#253348',
                'line-width': majorCasingWidth,
                'line-opacity': 0.36,
                'line-dasharray': [2.2, 1.8],
            },
        },
        {
            id: 'base_road_major_corridor',
            type: 'line',
            source,
            'source-layer': sourceLayer,
            filter: majorCarriagewayFilter,
            minzoom: 14,
            layout: {
                'line-cap': 'round',
                'line-join': 'round',
            },
            paint: {
                'line-color': '#2B3647',
                'line-width': majorCorridorWidth,
                'line-opacity': ['interpolate', ['linear'], ['zoom'], 14, 0.08, 16, 0.2, 18, 0.34, 20, 0.42],
            },
        },
        {
            id: 'base_road_major_casing',
            type: 'line',
            source,
            'source-layer': sourceLayer,
            filter: ['all', majorRoadClassFilter, ['!', linkRoadFilter]],
            minzoom: 14,
            layout: {
                'line-cap': 'butt',
                'line-join': 'round',
            },
            paint: {
                'line-color': '#7F8EA2',
                'line-width': majorCasingWidth,
                'line-opacity': detailOpacity(0.18, 0.44, 0.64),
            },
        },
        {
            id: 'base_road_major_surface',
            type: 'line',
            source,
            'source-layer': sourceLayer,
            filter: ['all', majorRoadClassFilter, ['!', linkRoadFilter]],
            minzoom: 14,
            layout: {
                'line-cap': 'butt',
                'line-join': 'round',
            },
            paint: {
                'line-color': [
                    'match',
                    ['get', 'class'],
                    'motorway',
                    '#9EACBD',
                    'trunk',
                    '#A8B5C4',
                    'primary',
                    '#B2BECC',
                    'secondary',
                    '#BBC5D0',
                    '#C4CDD7',
                ],
                'line-width': majorSurfaceWidth,
                'line-opacity': detailOpacity(0.26, 0.58, 0.86),
            },
        },
        {
            id: 'base_road_ramp_casing',
            type: 'line',
            source,
            'source-layer': sourceLayer,
            filter: linkRoadFilter,
            minzoom: 14.8,
            layout: {
                'line-cap': 'round',
                'line-join': 'round',
            },
            paint: {
                'line-color': '#8392A6',
                'line-width': ['+', rampSurfaceWidth, 4],
                'line-opacity': detailOpacity(0.18, 0.48, 0.68),
            },
        },
        {
            id: 'base_road_ramp_surface',
            type: 'line',
            source,
            'source-layer': sourceLayer,
            filter: linkRoadFilter,
            minzoom: 14.8,
            layout: {
                'line-cap': 'round',
                'line-join': 'round',
            },
            paint: {
                'line-color': '#ADB9C8',
                'line-width': rampSurfaceWidth,
                'line-opacity': detailOpacity(0.28, 0.62, 0.88),
            },
        },
        {
            id: 'base_road_minor_casing',
            type: 'line',
            source,
            'source-layer': sourceLayer,
            filter: minorRoadClassFilter,
            minzoom: 15.2,
            layout: {
                'line-cap': 'round',
                'line-join': 'round',
            },
            paint: {
                'line-color': '#6F7F94',
                'line-width': ['+', minorSurfaceWidth, 3],
                'line-opacity': detailOpacity(0.06, 0.24, 0.38),
            },
        },
        {
            id: 'base_road_minor_surface',
            type: 'line',
            source,
            'source-layer': sourceLayer,
            filter: minorRoadClassFilter,
            minzoom: 15.2,
            layout: {
                'line-cap': 'round',
                'line-join': 'round',
            },
            paint: {
                'line-color': '#8C9AAF',
                'line-width': minorSurfaceWidth,
                'line-opacity': detailOpacity(0.12, 0.36, 0.58),
            },
        },
        laneGuideLayer({
            id: 'base_road_major_lane_guide_center',
            source,
            sourceLayer,
            filter: majorCarriagewayFilter,
            offset: 0,
            minzoom: 17.1,
        }),
        {
            id: 'base_road_major_edge_left',
            type: 'line',
            source,
            'source-layer': sourceLayer,
            filter: ['all', majorRoadClassFilter, ['!', linkRoadFilter]],
            minzoom: 16.4,
            layout: {
                'line-cap': 'butt',
                'line-join': 'round',
            },
            paint: {
                'line-color': '#D8E0EA',
                'line-width': ['interpolate', ['linear'], ['zoom'], 16.4, 0.55, 18, 1.05, 20, 1.6],
                'line-opacity': ['interpolate', ['linear'], ['zoom'], 16.4, 0.1, 18, 0.36, 20, 0.54],
                'line-offset': ['*', -1, edgeOffset],
            },
        },
        {
            id: 'base_road_major_edge_right',
            type: 'line',
            source,
            'source-layer': sourceLayer,
            filter: ['all', majorRoadClassFilter, ['!', linkRoadFilter]],
            minzoom: 16.4,
            layout: {
                'line-cap': 'butt',
                'line-join': 'round',
            },
            paint: {
                'line-color': '#D8E0EA',
                'line-width': ['interpolate', ['linear'], ['zoom'], 16.4, 0.55, 18, 1.05, 20, 1.6],
                'line-opacity': ['interpolate', ['linear'], ['zoom'], 16.4, 0.1, 18, 0.36, 20, 0.54],
                'line-offset': edgeOffset,
            },
        },
        {
            id: 'base_road_ramp_edge_left',
            type: 'line',
            source,
            'source-layer': sourceLayer,
            filter: linkRoadFilter,
            minzoom: 16.8,
            layout: {
                'line-cap': 'round',
                'line-join': 'round',
            },
            paint: {
                'line-color': '#DDE5EF',
                'line-width': ['interpolate', ['linear'], ['zoom'], 16.8, 0.5, 18, 0.9, 20, 1.35],
                'line-opacity': ['interpolate', ['linear'], ['zoom'], 16.8, 0.08, 18, 0.32, 20, 0.46],
                'line-offset': ['*', -1, rampEdgeOffset],
            },
        },
        {
            id: 'base_road_ramp_edge_right',
            type: 'line',
            source,
            'source-layer': sourceLayer,
            filter: linkRoadFilter,
            minzoom: 16.8,
            layout: {
                'line-cap': 'round',
                'line-join': 'round',
            },
            paint: {
                'line-color': '#DDE5EF',
                'line-width': ['interpolate', ['linear'], ['zoom'], 16.8, 0.5, 18, 0.9, 20, 1.35],
                'line-opacity': ['interpolate', ['linear'], ['zoom'], 16.8, 0.08, 18, 0.32, 20, 0.46],
                'line-offset': rampEdgeOffset,
            },
        },
        laneGuideLayer({
            id: 'base_road_major_lane_guide_inner_left',
            source,
            sourceLayer,
            filter: majorCarriagewayFilter,
            offset: -1,
            minzoom: 17,
        }),
        laneGuideLayer({
            id: 'base_road_major_lane_guide_inner_right',
            source,
            sourceLayer,
            filter: majorCarriagewayFilter,
            offset: 1,
            minzoom: 17,
        }),
        laneGuideLayer({
            id: 'base_road_major_lane_guide_outer_left',
            source,
            sourceLayer,
            filter: majorCarriagewayFilter,
            offset: -2,
            minzoom: 18.1,
            opacity: secondaryLaneGuideOpacity,
        }),
        laneGuideLayer({
            id: 'base_road_major_lane_guide_outer_right',
            source,
            sourceLayer,
            filter: majorCarriagewayFilter,
            offset: 2,
            minzoom: 18.1,
            opacity: secondaryLaneGuideOpacity,
        }),
        laneGuideLayer({
            id: 'base_road_ramp_lane_guide',
            source,
            sourceLayer,
            filter: linkRoadFilter,
            offset: 0,
            minzoom: 17.2,
            opacity: rampLaneGuideOpacity,
        }),
        {
            id: 'base_road_bridge_rail_left',
            type: 'line',
            source,
            'source-layer': sourceLayer,
            filter: ['all', roadClassFilter, bridgeFilter],
            minzoom: 16.2,
            layout: {
                'line-cap': 'butt',
                'line-join': 'round',
            },
            paint: {
                'line-color': '#F3F7FC',
                'line-width': ['interpolate', ['linear'], ['zoom'], 16.2, 0.7, 18, 1.25, 20, 1.8],
                'line-opacity': ['interpolate', ['linear'], ['zoom'], 16.2, 0.12, 18, 0.42, 20, 0.58],
                'line-offset': ['*', -1, edgeOffset],
            },
        },
        {
            id: 'base_road_bridge_rail_right',
            type: 'line',
            source,
            'source-layer': sourceLayer,
            filter: ['all', roadClassFilter, bridgeFilter],
            minzoom: 16.2,
            layout: {
                'line-cap': 'butt',
                'line-join': 'round',
            },
            paint: {
                'line-color': '#F3F7FC',
                'line-width': ['interpolate', ['linear'], ['zoom'], 16.2, 0.7, 18, 1.25, 20, 1.8],
                'line-opacity': ['interpolate', ['linear'], ['zoom'], 16.2, 0.12, 18, 0.42, 20, 0.58],
                'line-offset': edgeOffset,
            },
        },
    ];
}
