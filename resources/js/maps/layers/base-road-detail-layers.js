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
    ['*', 12, roadWidthFactor],
    15,
    ['*', 21, roadWidthFactor],
    16,
    ['*', 34, roadWidthFactor],
    17,
    ['*', 52, roadWidthFactor],
    18,
    ['*', 76, roadWidthFactor],
    19,
    ['*', 108, roadWidthFactor],
    20,
    ['*', 148, roadWidthFactor],
];

const majorCasingWidth = [
    'interpolate',
    ['linear'],
    ['zoom'],
    14,
    ['*', 16, roadWidthFactor],
    15,
    ['*', 26, roadWidthFactor],
    16,
    ['*', 42, roadWidthFactor],
    17,
    ['*', 62, roadWidthFactor],
    18,
    ['*', 90, roadWidthFactor],
    19,
    ['*', 126, roadWidthFactor],
    20,
    ['*', 174, roadWidthFactor],
];

const majorCorridorWidth = [
    'interpolate',
    ['linear'],
    ['zoom'],
    14,
    ['*', 28, roadWidthFactor],
    15,
    ['*', 48, roadWidthFactor],
    16,
    ['*', 78, roadWidthFactor],
    17,
    ['*', 116, roadWidthFactor],
    18,
    ['*', 168, roadWidthFactor],
    19,
    ['*', 236, roadWidthFactor],
    20,
    ['*', 320, roadWidthFactor],
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
const laneGuideOpacity = ['interpolate', ['linear'], ['zoom'], 17, 0.34, 18, 0.62, 19, 0.76, 20, 0.82];
const secondaryLaneGuideOpacity = ['interpolate', ['linear'], ['zoom'], 17.8, 0.12, 18.5, 0.42, 20, 0.58];
const rampLaneGuideOpacity = ['interpolate', ['linear'], ['zoom'], 17.2, 0.22, 18, 0.46, 20, 0.62];
const edgeLineWidth = ['interpolate', ['linear'], ['zoom'], 16.4, 0.8, 18, 1.35, 20, 2];

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
            'line-color': '#DCE6F1',
            'line-width': laneGuideWidth,
            'line-opacity': opacity,
            'line-offset': guideOffset(offset),
            'line-dasharray': [4.4, 3.4],
        },
    };
}

function laneSolidLayer({ id, source, sourceLayer, filter, offset, minzoom = 17.4, opacity = laneGuideOpacity }) {
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
            'line-color': '#E6EEF7',
            'line-width': ['interpolate', ['linear'], ['zoom'], 17.4, 0.75, 19, 1.2, 20, 1.65],
            'line-opacity': opacity,
            'line-offset': guideOffset(offset),
        },
    };
}

function roadArrowLayer({ id, source, sourceLayer, filter, minzoom = 18.2 }) {
    return {
        id,
        type: 'symbol',
        source,
        'source-layer': sourceLayer,
        filter,
        minzoom,
        layout: {
            'symbol-placement': 'line',
            'symbol-spacing': ['interpolate', ['linear'], ['zoom'], 18.2, 150, 20, 210],
            'text-field': '➜',
            'text-font': ['Noto Sans Bold'],
            'text-size': ['interpolate', ['linear'], ['zoom'], 18.2, 13, 20, 18],
            'text-rotation-alignment': 'map',
            'text-pitch-alignment': 'map',
            'text-keep-upright': false,
            'text-allow-overlap': false,
            'text-ignore-placement': false,
        },
        paint: {
            'text-color': '#DCE6F1',
            'text-halo-color': 'rgba(34, 45, 60, 0.38)',
            'text-halo-width': 0.8,
            'text-opacity': ['interpolate', ['linear'], ['zoom'], 18.2, 0.42, 20, 0.68],
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
            id: 'base_road_minor_casing',
            type: 'line',
            source,
            'source-layer': sourceLayer,
            filter: minorRoadClassFilter,
            minzoom: 15.2,
            layout: {
                'line-cap': 'square',
                'line-join': 'round',
            },
            paint: {
                'line-color': '#435064',
                'line-width': ['+', minorSurfaceWidth, 3],
                'line-opacity': detailOpacity(0.04, 0.18, 0.32),
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
                'line-cap': 'square',
                'line-join': 'round',
            },
            paint: {
                'line-color': '#657286',
                'line-width': minorSurfaceWidth,
                'line-opacity': detailOpacity(0.08, 0.28, 0.46),
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
                'line-cap': 'square',
                'line-join': 'round',
            },
            paint: {
                'line-color': '#2E3A4D',
                'line-width': majorCorridorWidth,
                'line-opacity': ['interpolate', ['linear'], ['zoom'], 14, 0.14, 16, 0.36, 18, 0.62, 20, 0.76],
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
                'line-cap': 'square',
                'line-join': 'round',
            },
            paint: {
                'line-color': '#4F5D72',
                'line-width': majorCasingWidth,
                'line-opacity': detailOpacity(0.2, 0.52, 0.78),
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
                'line-cap': 'square',
                'line-join': 'round',
            },
            paint: {
                'line-color': [
                    'match',
                    ['get', 'class'],
                    'motorway',
                    '#748399',
                    'trunk',
                    '#77869C',
                    'primary',
                    '#7B8AA0',
                    'secondary',
                    '#8190A4',
                    '#8795A8',
                ],
                'line-width': majorSurfaceWidth,
                'line-opacity': detailOpacity(0.34, 0.72, 0.96),
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
                'line-cap': 'square',
                'line-join': 'round',
            },
            paint: {
                'line-color': '#536176',
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
                'line-cap': 'square',
                'line-join': 'round',
            },
            paint: {
                'line-color': '#7A899E',
                'line-width': rampSurfaceWidth,
                'line-opacity': detailOpacity(0.32, 0.7, 0.94),
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
        laneSolidLayer({
            id: 'base_road_major_center_solid',
            source,
            sourceLayer,
            filter: majorCarriagewayFilter,
            offset: 0,
            minzoom: 18.2,
            opacity: ['interpolate', ['linear'], ['zoom'], 18.2, 0.18, 20, 0.34],
        }),
        {
            id: 'base_road_major_edge_left',
            type: 'line',
            source,
            'source-layer': sourceLayer,
            filter: ['all', majorRoadClassFilter, ['!', linkRoadFilter]],
            minzoom: 16.4,
            layout: {
                'line-cap': 'round',
                'line-join': 'round',
            },
            paint: {
                'line-color': '#C5D0DE',
                'line-width': edgeLineWidth,
                'line-opacity': ['interpolate', ['linear'], ['zoom'], 16.4, 0.18, 18, 0.54, 20, 0.72],
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
                'line-cap': 'round',
                'line-join': 'round',
            },
            paint: {
                'line-color': '#C5D0DE',
                'line-width': edgeLineWidth,
                'line-opacity': ['interpolate', ['linear'], ['zoom'], 16.4, 0.18, 18, 0.54, 20, 0.72],
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
                'line-color': '#CBD5E1',
                'line-width': ['interpolate', ['linear'], ['zoom'], 16.8, 0.65, 18, 1.15, 20, 1.65],
                'line-opacity': ['interpolate', ['linear'], ['zoom'], 16.8, 0.14, 18, 0.42, 20, 0.6],
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
                'line-color': '#CBD5E1',
                'line-width': ['interpolate', ['linear'], ['zoom'], 16.8, 0.65, 18, 1.15, 20, 1.65],
                'line-opacity': ['interpolate', ['linear'], ['zoom'], 16.8, 0.14, 18, 0.42, 20, 0.6],
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
            id: 'base_road_major_lane_guide_far_left',
            source,
            sourceLayer,
            filter: majorCarriagewayFilter,
            offset: -3,
            minzoom: 18.8,
            opacity: ['interpolate', ['linear'], ['zoom'], 18.8, 0.08, 20, 0.38],
        }),
        laneGuideLayer({
            id: 'base_road_major_lane_guide_far_right',
            source,
            sourceLayer,
            filter: majorCarriagewayFilter,
            offset: 3,
            minzoom: 18.8,
            opacity: ['interpolate', ['linear'], ['zoom'], 18.8, 0.08, 20, 0.38],
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
        roadArrowLayer({
            id: 'base_road_ramp_direction_arrows',
            source,
            sourceLayer,
            filter: linkRoadFilter,
            minzoom: 18.2,
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
