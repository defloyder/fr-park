import { ROAD_MARKING_ARROW_IMAGES, ROAD_MARKING_COLORS, ROAD_MARKING_TRAFFIC_SIGNAL_IMAGE } from './roadMarkingConfig';
import { ROAD_MARKINGS_SOURCE_ID } from './roadMarkingSources';

const featureTypeFilter = (featureType) => ['==', ['get', 'feature_type'], featureType];
const markingTypeFilter = (...markingTypes) => ['in', ['get', 'marking_type'], ['literal', markingTypes]];
const majorRoadMarkingFilter = ['in', ['get', 'road_class'], ['literal', ['motorway', 'trunk', 'primary', 'secondary', 'tertiary']]];
const explicitLaneMarkingFilter = ['!=', ['get', 'source'], 'osm_estimated_lanes'];
const estimatedLaneMarkingFilter = ['==', ['get', 'source'], 'osm_estimated_lanes'];
const bridgeLevelFilter = ['>=', ['coalesce', ['to-number', ['get', 'structure_level']], 0], 1];

const markingColor = [
    'match',
    ['get', 'color'],
    'yellow',
    ROAD_MARKING_COLORS.white,
    'muted',
    ROAD_MARKING_COLORS.mutedWhite,
    ROAD_MARKING_COLORS.white,
];

const laneLineWidth = ['interpolate', ['linear'], ['zoom'], 16.5, 1.3, 18, 2.25, 20, 3.35];
const doubleLineWidth = ['interpolate', ['linear'], ['zoom'], 16.7, 0.82, 18.5, 1.22, 20, 1.55];
const edgeLineWidth = ['interpolate', ['linear'], ['zoom'], 16.5, 1.25, 18, 2.05, 20, 3.05];
const stopLineWidth = ['interpolate', ['linear'], ['zoom'], 17, 3.6, 19, 6.4, 20, 8.2];
const intersectionMaskWidth = [
    'interpolate',
    ['linear'],
    ['zoom'],
    16.8,
    ['*', ['coalesce', ['to-number', ['get', 'lanes_total']], 2], 7],
    18.4,
    ['*', ['coalesce', ['to-number', ['get', 'lanes_total']], 2], 11.5],
    20,
    ['*', ['coalesce', ['to-number', ['get', 'lanes_total']], 2], 17.5],
];
const roadMaskWidth = [
    'interpolate',
    ['linear'],
    ['zoom'],
    16.5,
    ['*', ['coalesce', ['to-number', ['get', 'lanes_total']], 2], 5.5],
    18,
    ['*', ['coalesce', ['to-number', ['get', 'lanes_total']], 2], 9.5],
    20,
    ['*', ['coalesce', ['to-number', ['get', 'lanes_total']], 2], 15.5],
];

export function createRoadMarkingLayers({ source = ROAD_MARKINGS_SOURCE_ID, sourceLayer = null } = {}) {
    return roadMarkingLayerDefinitions.map((layer) => {
        const nextLayer = {
            ...layer,
            source,
        };

        if (sourceLayer) {
            nextLayer['source-layer'] = sourceLayer;
        }

        return nextLayer;
    });
}

const baseRoadMarkingLayerDefinitions = [
    {
        id: 'road_marking_bus_lanes',
        type: 'line',
        filter: featureTypeFilter('bus_lane'),
        minzoom: 16,
        layout: {
            'line-cap': 'butt',
            'line-join': 'round',
        },
        paint: {
            'line-color': ROAD_MARKING_COLORS.bus,
            'line-width': ['interpolate', ['linear'], ['zoom'], 16, 1.8, 18, 3.4, 20, 5.4],
            'line-opacity': ['interpolate', ['linear'], ['zoom'], 16, 0.28, 18.5, 0.56, 20, 0.72],
        },
    },
    {
        id: 'road_marking_estimated_dashed',
        type: 'line',
        filter: ['all', featureTypeFilter('lane_marking'), markingTypeFilter('dashed'), estimatedLaneMarkingFilter],
        minzoom: 17.6,
        layout: {
            'line-cap': 'butt',
            'line-join': 'round',
        },
        paint: {
            'line-color': ROAD_MARKING_COLORS.mutedWhite,
            'line-width': ['interpolate', ['linear'], ['zoom'], 17.6, 0.9, 19, 1.45, 20, 1.9],
            'line-opacity': ['interpolate', ['linear'], ['zoom'], 17.6, 0.22, 19, 0.42, 20, 0.54],
            'line-dasharray': ['literal', [4.4, 4.2]],
        },
    },
    {
        id: 'road_marking_estimated_double_left',
        type: 'line',
        filter: ['all', featureTypeFilter('lane_marking'), markingTypeFilter('double_solid'), estimatedLaneMarkingFilter],
        minzoom: 17.8,
        layout: {
            'line-cap': 'round',
            'line-join': 'round',
        },
        paint: {
            'line-color': ROAD_MARKING_COLORS.mutedWhite,
            'line-width': ['interpolate', ['linear'], ['zoom'], 17.8, 0.65, 20, 1.15],
            'line-opacity': ['interpolate', ['linear'], ['zoom'], 17.8, 0.18, 19, 0.34, 20, 0.46],
            'line-offset': ['interpolate', ['linear'], ['zoom'], 17.8, -1, 20, -2.4],
        },
    },
    {
        id: 'road_marking_estimated_double_right',
        type: 'line',
        filter: ['all', featureTypeFilter('lane_marking'), markingTypeFilter('double_solid'), estimatedLaneMarkingFilter],
        minzoom: 17.8,
        layout: {
            'line-cap': 'round',
            'line-join': 'round',
        },
        paint: {
            'line-color': ROAD_MARKING_COLORS.mutedWhite,
            'line-width': ['interpolate', ['linear'], ['zoom'], 17.8, 0.65, 20, 1.15],
            'line-opacity': ['interpolate', ['linear'], ['zoom'], 17.8, 0.18, 19, 0.34, 20, 0.46],
            'line-offset': ['interpolate', ['linear'], ['zoom'], 17.8, 1, 20, 2.4],
        },
    },
    {
        id: 'road_marking_edges',
        type: 'line',
        filter: ['all', featureTypeFilter('lane_marking'), markingTypeFilter('edge_line'), majorRoadMarkingFilter, ['!=', ['get', 'is_link'], true]],
        minzoom: 16.5,
        layout: {
            'line-cap': 'round',
            'line-join': 'round',
        },
        paint: {
            'line-color': ROAD_MARKING_COLORS.mutedWhite,
            'line-width': edgeLineWidth,
            'line-opacity': ['interpolate', ['linear'], ['zoom'], 16.5, 0.48, 18, 0.74, 20, 0.88],
        },
    },
    {
        id: 'road_marking_guides',
        type: 'line',
        filter: ['all', featureTypeFilter('lane_marking'), markingTypeFilter('guide_line'), explicitLaneMarkingFilter],
        minzoom: 17,
        layout: {
            'line-cap': 'round',
            'line-join': 'round',
        },
        paint: {
            'line-color': ROAD_MARKING_COLORS.mutedWhite,
            'line-width': laneLineWidth,
            'line-opacity': ['interpolate', ['linear'], ['zoom'], 17, 0.5, 19, 0.78],
        },
    },
    {
        id: 'road_marking_dashed',
        type: 'line',
        filter: ['all', featureTypeFilter('lane_marking'), markingTypeFilter('dashed', 'bus_lane_border'), explicitLaneMarkingFilter],
        minzoom: 16.7,
        layout: {
            'line-cap': 'butt',
            'line-join': 'round',
        },
        paint: {
            'line-color': markingColor,
            'line-width': laneLineWidth,
            'line-opacity': ['interpolate', ['linear'], ['zoom'], 16.7, 0.58, 18, 0.82, 20, 0.92],
            'line-dasharray': ['literal', [4.6, 3.4]],
        },
    },
    {
        id: 'road_marking_solid',
        type: 'line',
        filter: ['all', featureTypeFilter('lane_marking'), markingTypeFilter('solid', 'solid_dashed', 'dashed_solid'), explicitLaneMarkingFilter],
        minzoom: 16.7,
        layout: {
            'line-cap': 'round',
            'line-join': 'round',
        },
        paint: {
            'line-color': markingColor,
            'line-width': laneLineWidth,
            'line-opacity': ['interpolate', ['linear'], ['zoom'], 16.7, 0.62, 18, 0.86, 20, 0.96],
        },
    },
    {
        id: 'road_marking_double_solid_left',
        type: 'line',
        filter: ['all', featureTypeFilter('lane_marking'), markingTypeFilter('double_solid'), explicitLaneMarkingFilter],
        minzoom: 16.7,
        layout: {
            'line-cap': 'round',
            'line-join': 'round',
        },
        paint: {
            'line-color': markingColor,
            'line-width': doubleLineWidth,
            'line-opacity': ['interpolate', ['linear'], ['zoom'], 16.7, 0.64, 18, 0.88, 20, 0.96],
            'line-offset': ['interpolate', ['linear'], ['zoom'], 16.7, -1.2, 19, -2.25, 20, -3.2],
        },
    },
    {
        id: 'road_marking_double_solid_right',
        type: 'line',
        filter: ['all', featureTypeFilter('lane_marking'), markingTypeFilter('double_solid'), explicitLaneMarkingFilter],
        minzoom: 16.7,
        layout: {
            'line-cap': 'round',
            'line-join': 'round',
        },
        paint: {
            'line-color': markingColor,
            'line-width': doubleLineWidth,
            'line-opacity': ['interpolate', ['linear'], ['zoom'], 16.7, 0.64, 18, 0.88, 20, 0.96],
            'line-offset': ['interpolate', ['linear'], ['zoom'], 16.7, 1.2, 19, 2.25, 20, 3.2],
        },
    },
    {
        id: 'road_marking_intersection_masks',
        type: 'line',
        filter: featureTypeFilter('intersection_mask'),
        minzoom: 16.8,
        layout: {
            'line-cap': 'round',
            'line-join': 'round',
        },
        paint: {
            'line-color': '#8A9AAB',
            'line-width': intersectionMaskWidth,
            'line-opacity': 1,
        },
    },
    {
        id: 'road_marking_crosswalks',
        type: 'line',
        filter: featureTypeFilter('crosswalk'),
        minzoom: 17.2,
        layout: {
            'line-cap': 'butt',
            'line-join': 'round',
        },
        paint: {
            'line-color': ROAD_MARKING_COLORS.brightWhite,
            'line-width': ['interpolate', ['linear'], ['zoom'], 17.2, 6.2, 19, 11, 20, 14],
            'line-opacity': ['interpolate', ['linear'], ['zoom'], 17.2, 0.62, 19, 0.9],
            'line-dasharray': ['literal', [0.42, 0.52]],
        },
    },
    {
        id: 'road_marking_stop_lines',
        type: 'line',
        filter: featureTypeFilter('stop_line'),
        minzoom: 17.2,
        layout: {
            'line-cap': 'butt',
            'line-join': 'round',
        },
        paint: {
            'line-color': ROAD_MARKING_COLORS.brightWhite,
            'line-width': stopLineWidth,
            'line-opacity': ['interpolate', ['linear'], ['zoom'], 17.2, 0.68, 19, 0.94],
        },
    },
    {
        id: 'road_marking_yellow_box_lines',
        type: 'line',
        filter: featureTypeFilter('yellow_box_line'),
        minzoom: 18,
        layout: {
            'line-cap': 'butt',
            'line-join': 'round',
        },
        paint: {
            'line-color': ROAD_MARKING_COLORS.yellow,
            'line-width': ['interpolate', ['linear'], ['zoom'], 18, 1.4, 20, 2.25],
            'line-opacity': 0.86,
        },
    },
    {
        id: 'road_marking_hatched_area_lines',
        type: 'line',
        filter: featureTypeFilter('hatched_area_line'),
        minzoom: 17.5,
        layout: {
            'line-cap': 'butt',
            'line-join': 'round',
        },
        paint: {
            'line-color': markingColor,
            'line-width': ['interpolate', ['linear'], ['zoom'], 17.5, 1.35, 20, 2.15],
            'line-opacity': 0.82,
        },
    },
    {
        id: 'road_marking_bus_lane_symbols',
        type: 'symbol',
        filter: featureTypeFilter('bus_lane'),
        minzoom: 18.4,
        layout: {
            'symbol-placement': 'line',
            'symbol-spacing': ['interpolate', ['linear'], ['zoom'], 18.2, 120, 20, 180],
            'text-field': 'A',
            'text-size': ['interpolate', ['linear'], ['zoom'], 18.2, 11, 20, 17],
            'text-font': ['literal', ['Noto Sans Regular']],
            'text-rotation-alignment': 'map',
            'text-pitch-alignment': 'map',
            'text-keep-upright': false,
            'text-allow-overlap': true,
            'text-ignore-placement': true,
        },
        paint: {
            'text-color': ROAD_MARKING_COLORS.bus,
            'text-opacity': ['interpolate', ['linear'], ['zoom'], 18.4, 0.42, 20, 0.82],
            'text-halo-color': 'rgba(33, 48, 66, 0.18)',
            'text-halo-width': 0.7,
        },
    },
    {
        id: 'road_marking_turn_arrows',
        type: 'symbol',
        filter: ['all', featureTypeFilter('turn_arrow'), ['!=', ['get', 'source'], 'osm_direction']],
        minzoom: 17.8,
        layout: {
            'icon-image': [
                'match',
                ['get', 'turn'],
                'left',
                ROAD_MARKING_ARROW_IMAGES.left,
                'right',
                ROAD_MARKING_ARROW_IMAGES.right,
                'through_left',
                ROAD_MARKING_ARROW_IMAGES.through_left,
                'through_right',
                ROAD_MARKING_ARROW_IMAGES.through_right,
                'left_right',
                ROAD_MARKING_ARROW_IMAGES.left_right,
                'u_turn',
                ROAD_MARKING_ARROW_IMAGES.u_turn,
                'slight_left',
                ROAD_MARKING_ARROW_IMAGES.slight_left,
                'slight_right',
                ROAD_MARKING_ARROW_IMAGES.slight_right,
                ROAD_MARKING_ARROW_IMAGES.through,
            ],
            'icon-size': ['interpolate', ['linear'], ['zoom'], 17.8, 0.48, 19, 0.82, 20, 1.08],
            'icon-rotate': ['coalesce', ['to-number', ['get', 'bearing']], 0],
            'icon-rotation-alignment': 'map',
            'icon-pitch-alignment': 'map',
            'icon-keep-upright': false,
            'icon-allow-overlap': true,
            'icon-ignore-placement': true,
        },
        paint: {
            'icon-opacity': ['interpolate', ['linear'], ['zoom'], 17.8, 0.48, 19, 0.82, 20, 0.94],
        },
    },
    {
        id: 'road_marking_speed_markings',
        type: 'symbol',
        filter: featureTypeFilter('speed_marking'),
        minzoom: 18.3,
        layout: {
            'text-field': ['get', 'maxspeed'],
            'text-size': ['interpolate', ['linear'], ['zoom'], 18.3, 10, 20, 16],
            'text-font': ['literal', ['Noto Sans Bold']],
            'text-rotate': ['coalesce', ['to-number', ['get', 'bearing']], 0],
            'text-rotation-alignment': 'map',
            'text-pitch-alignment': 'map',
            'text-keep-upright': false,
            'text-allow-overlap': false,
            'text-ignore-placement': false,
        },
        paint: {
            'text-color': ROAD_MARKING_COLORS.brightWhite,
            'text-opacity': ['interpolate', ['linear'], ['zoom'], 18.3, 0.46, 19.5, 0.8, 20, 0.9],
            'text-halo-color': 'rgba(35, 50, 68, 0.28)',
            'text-halo-width': 0.8,
        },
    },
    {
        id: 'road_marking_traffic_signals',
        type: 'symbol',
        filter: featureTypeFilter('traffic_signal'),
        minzoom: 18.2,
        layout: {
            'icon-image': ROAD_MARKING_TRAFFIC_SIGNAL_IMAGE,
            'icon-size': ['interpolate', ['linear'], ['zoom'], 18.2, 0.42, 20, 0.72],
            'icon-allow-overlap': true,
            'icon-ignore-placement': true,
        },
        paint: {
            'icon-opacity': ['interpolate', ['linear'], ['zoom'], 18.2, 0.52, 19.5, 0.92],
        },
    },
];

const bridgeReplayLayerIds = new Set([
    'road_marking_bus_lanes',
    'road_marking_edges',
    'road_marking_guides',
    'road_marking_dashed',
    'road_marking_solid',
    'road_marking_double_solid_left',
    'road_marking_double_solid_right',
    'road_marking_turn_arrows',
    'road_marking_speed_markings',
]);

const bridgeMaskLayerDefinition = {
    id: 'road_marking_bridge_masks',
    type: 'line',
    filter: ['all', featureTypeFilter('road_mask'), bridgeLevelFilter],
    minzoom: 16.5,
    layout: {
        'line-cap': 'round',
        'line-join': 'round',
    },
    paint: {
        'line-color': '#8A9AAB',
        'line-width': roadMaskWidth,
        'line-opacity': 1,
    },
};

function withExtraFilter(layer, suffix, extraFilter) {
    return {
        ...layer,
        id: `${layer.id}${suffix}`,
        filter: ['all', layer.filter, extraFilter],
        layout: layer.layout ? { ...layer.layout } : undefined,
        paint: layer.paint ? { ...layer.paint } : undefined,
    };
}

export const roadMarkingLayerDefinitions = [
    ...baseRoadMarkingLayerDefinitions,
    bridgeMaskLayerDefinition,
    ...baseRoadMarkingLayerDefinitions
        .filter((layer) => bridgeReplayLayerIds.has(layer.id))
        .map((layer) => withExtraFilter(layer, '_bridge', bridgeLevelFilter)),
];
