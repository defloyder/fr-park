import { ROAD_MARKING_ARROW_IMAGES, ROAD_MARKING_COLORS } from './roadMarkingConfig';
import { ROAD_MARKINGS_SOURCE_ID } from './roadMarkingSources';

const featureTypeFilter = (featureType) => ['==', ['get', 'feature_type'], featureType];
const markingTypeFilter = (...markingTypes) => ['in', ['get', 'marking_type'], ['literal', markingTypes]];
const majorRoadMarkingFilter = ['in', ['get', 'road_class'], ['literal', ['motorway', 'trunk', 'primary', 'secondary', 'tertiary']]];
const explicitLaneMarkingFilter = ['!=', ['get', 'source'], 'osm_estimated_lanes'];
const sourceLineOffset = ['coalesce', ['to-number', ['get', 'offset_px']], 0];
const scaledLineOffset = (scale) => ['*', sourceLineOffset, scale];
const lineOffset = [
    'interpolate',
    ['linear'],
    ['zoom'],
    16.5,
    scaledLineOffset(3.4),
    18,
    scaledLineOffset(5.8),
    19,
    scaledLineOffset(7),
    20,
    scaledLineOffset(8.6),
];

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
const edgeLineWidth = ['interpolate', ['linear'], ['zoom'], 16.5, 1.25, 18, 2.05, 20, 3.05];
const stopLineWidth = ['interpolate', ['linear'], ['zoom'], 17, 3.6, 19, 6.4, 20, 8.2];

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

export const roadMarkingLayerDefinitions = [
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
            'line-width': ['interpolate', ['linear'], ['zoom'], 16, 1.8, 18, 3.2, 20, 4.8],
            'line-opacity': ['interpolate', ['linear'], ['zoom'], 16, 0.22, 19, 0.42],
            'line-offset': lineOffset,
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
            'line-offset': lineOffset,
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
            'line-offset': lineOffset,
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
            'line-offset': lineOffset,
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
            'line-offset': lineOffset,
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
            'line-width': laneLineWidth,
            'line-opacity': ['interpolate', ['linear'], ['zoom'], 16.7, 0.64, 18, 0.88, 20, 0.96],
            'line-offset': ['interpolate', ['linear'], ['zoom'], 16.7, ['+', scaledLineOffset(3.8), -1.2], 19, ['+', scaledLineOffset(7), -2], 20, ['+', scaledLineOffset(8.6), -2.8]],
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
            'line-width': laneLineWidth,
            'line-opacity': ['interpolate', ['linear'], ['zoom'], 16.7, 0.64, 18, 0.88, 20, 0.96],
            'line-offset': ['interpolate', ['linear'], ['zoom'], 16.7, ['+', scaledLineOffset(3.8), 1.2], 19, ['+', scaledLineOffset(7), 2], 20, ['+', scaledLineOffset(8.6), 2.8]],
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
        id: 'road_marking_turn_arrows',
        type: 'symbol',
        filter: ['all', featureTypeFilter('turn_arrow'), ['!=', ['get', 'source'], 'osm_direction']],
        minzoom: 18.8,
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
            'icon-size': ['interpolate', ['linear'], ['zoom'], 18.8, 0.46, 19.5, 0.74, 20, 0.9],
            'icon-rotate': ['coalesce', ['to-number', ['get', 'bearing']], 0],
            'icon-rotation-alignment': 'map',
            'icon-pitch-alignment': 'map',
            'icon-keep-upright': false,
            'icon-allow-overlap': false,
            'icon-ignore-placement': false,
        },
        paint: {
            'icon-opacity': ['interpolate', ['linear'], ['zoom'], 18.8, 0.45, 19.5, 0.78, 20, 0.9],
        },
    },
];
