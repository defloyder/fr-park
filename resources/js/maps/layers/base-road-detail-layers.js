const ROAD_CLASSES = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor', 'service'];
const MAJOR_ROAD_CLASSES = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary'];
const LINK_ROAD_CLASSES = ['motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link'];

const roadClassFilter = ['in', ['get', 'class'], ['literal', ROAD_CLASSES]];
const majorRoadClassFilter = ['in', ['get', 'class'], ['literal', MAJOR_ROAD_CLASSES]];
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
    ['>', ['to-number', ['get', 'layer'], 0], 0],
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
    0.44,
    'service',
    0.34,
    0.5,
];

const surfaceWidth = [
    'interpolate',
    ['linear'],
    ['zoom'],
    16,
    ['*', 21, roadWidthFactor],
    17,
    ['*', 31, roadWidthFactor],
    18,
    ['*', 44, roadWidthFactor],
    19,
    ['*', 62, roadWidthFactor],
    20,
    ['*', 84, roadWidthFactor],
];

const edgeOffset = [
    'interpolate',
    ['linear'],
    ['zoom'],
    16,
    ['*', 10.5, roadWidthFactor],
    17,
    ['*', 15.5, roadWidthFactor],
    18,
    ['*', 22, roadWidthFactor],
    19,
    ['*', 31, roadWidthFactor],
    20,
    ['*', 42, roadWidthFactor],
];

const laneOffset = (direction) => [
    '*',
    direction,
    [
        'interpolate',
        ['linear'],
        ['zoom'],
        17,
        5,
        18,
        7.2,
        19,
        10.2,
        20,
        13.8,
    ],
];

export function createBaseRoadDetailLayers({ source, sourceLayer = 'transportation' }) {
    return [
        {
            id: 'base_road_surfaces',
            type: 'line',
            source,
            'source-layer': sourceLayer,
            filter: roadClassFilter,
            minzoom: 16,
            layout: {
                'line-cap': 'round',
                'line-join': 'round',
            },
            paint: {
                'line-color': '#D9E0E8',
                'line-width': surfaceWidth,
                'line-opacity': [
                    'interpolate',
                    ['linear'],
                    ['zoom'],
                    16,
                    0,
                    17,
                    0.08,
                    18,
                    0.14,
                ],
            },
        },
        {
            id: 'base_road_bridge_shadow',
            type: 'line',
            source,
            'source-layer': sourceLayer,
            filter: ['all', roadClassFilter, bridgeFilter],
            minzoom: 15,
            layout: {
                'line-cap': 'round',
                'line-join': 'round',
            },
            paint: {
                'line-color': 'rgba(0, 0, 0, 0.34)',
                'line-width': ['interpolate', ['linear'], ['zoom'], 15, 4, 17, 9, 19, 16],
                'line-translate': [0, 5],
                'line-translate-anchor': 'viewport',
                'line-blur': 3,
                'line-opacity': 0.38,
            },
        },
        {
            id: 'base_road_ramp_surface',
            type: 'line',
            source,
            'source-layer': sourceLayer,
            filter: linkRoadFilter,
            minzoom: 15.5,
            layout: {
                'line-cap': 'round',
                'line-join': 'round',
            },
            paint: {
                'line-color': '#DCE4EC',
                'line-width': ['interpolate', ['linear'], ['zoom'], 15.5, 5, 17, 12, 19, 22],
                'line-opacity': 0.28,
            },
        },
        {
            id: 'base_road_edge_left',
            type: 'line',
            source,
            'source-layer': sourceLayer,
            filter: roadClassFilter,
            minzoom: 16.5,
            layout: {
                'line-cap': 'round',
                'line-join': 'round',
            },
            paint: {
                'line-color': '#F8FAFC',
                'line-width': ['interpolate', ['linear'], ['zoom'], 16.5, 0.65, 18, 1, 20, 1.4],
                'line-opacity': [
                    'interpolate',
                    ['linear'],
                    ['zoom'],
                    16.5,
                    0.12,
                    18,
                    0.28,
                ],
                'line-offset': ['*', -1, edgeOffset],
            },
        },
        {
            id: 'base_road_edge_right',
            type: 'line',
            source,
            'source-layer': sourceLayer,
            filter: roadClassFilter,
            minzoom: 16.5,
            layout: {
                'line-cap': 'round',
                'line-join': 'round',
            },
            paint: {
                'line-color': '#F8FAFC',
                'line-width': ['interpolate', ['linear'], ['zoom'], 16.5, 0.65, 18, 1, 20, 1.4],
                'line-opacity': [
                    'interpolate',
                    ['linear'],
                    ['zoom'],
                    16.5,
                    0.12,
                    18,
                    0.28,
                ],
                'line-offset': edgeOffset,
            },
        },
        {
            id: 'base_road_bridge_rail_left',
            type: 'line',
            source,
            'source-layer': sourceLayer,
            filter: ['all', roadClassFilter, bridgeFilter],
            minzoom: 16,
            layout: {
                'line-cap': 'round',
                'line-join': 'round',
            },
            paint: {
                'line-color': '#F8FAFC',
                'line-width': ['interpolate', ['linear'], ['zoom'], 16, 0.8, 18, 1.3, 20, 1.8],
                'line-opacity': 0.5,
                'line-offset': ['*', -1, edgeOffset],
            },
        },
        {
            id: 'base_road_bridge_rail_right',
            type: 'line',
            source,
            'source-layer': sourceLayer,
            filter: ['all', roadClassFilter, bridgeFilter],
            minzoom: 16,
            layout: {
                'line-cap': 'round',
                'line-join': 'round',
            },
            paint: {
                'line-color': '#F8FAFC',
                'line-width': ['interpolate', ['linear'], ['zoom'], 16, 0.8, 18, 1.3, 20, 1.8],
                'line-opacity': 0.5,
                'line-offset': edgeOffset,
            },
        },
        {
            id: 'base_road_center_marking',
            type: 'line',
            source,
            'source-layer': sourceLayer,
            filter: majorRoadClassFilter,
            minzoom: 17,
            layout: {
                'line-cap': 'round',
                'line-join': 'round',
            },
            paint: {
                'line-color': '#F8FAFC',
                'line-width': ['interpolate', ['linear'], ['zoom'], 17, 0.7, 19, 1.2],
                'line-opacity': ['interpolate', ['linear'], ['zoom'], 17, 0.18, 18, 0.34],
                'line-dasharray': [2.2, 2.2],
            },
        },
        {
            id: 'base_road_lane_marking_left',
            type: 'line',
            source,
            'source-layer': sourceLayer,
            filter: majorRoadClassFilter,
            minzoom: 18,
            layout: {
                'line-cap': 'round',
                'line-join': 'round',
            },
            paint: {
                'line-color': '#E8EEF5',
                'line-width': ['interpolate', ['linear'], ['zoom'], 18, 0.65, 20, 1.05],
                'line-opacity': 0.24,
                'line-offset': laneOffset(-1),
                'line-dasharray': [1.8, 2.2],
            },
        },
        {
            id: 'base_road_lane_marking_right',
            type: 'line',
            source,
            'source-layer': sourceLayer,
            filter: majorRoadClassFilter,
            minzoom: 18,
            layout: {
                'line-cap': 'round',
                'line-join': 'round',
            },
            paint: {
                'line-color': '#E8EEF5',
                'line-width': ['interpolate', ['linear'], ['zoom'], 18, 0.65, 20, 1.05],
                'line-opacity': 0.24,
                'line-offset': laneOffset(1),
                'line-dasharray': [1.8, 2.2],
            },
        },
    ];
}
