import { ROAD_DETAILS_SOURCE_ID } from '../sources/road-detail-source';

const featureTypeFilter = (featureType) => ['==', ['get', 'feature_type'], featureType];
const lineOffset = ['coalesce', ['to-number', ['get', 'offset_px']], 0];
const explicitLaneDetailFilter = ['==', ['get', 'detail_quality'], 'explicit_lane_tags'];
const explicitLaneMarkingFilter = ['==', ['get', 'marking_source'], 'explicit_lanes'];

export function createRoadDetailLayers({ source = ROAD_DETAILS_SOURCE_ID, sourceLayer = null } = {}) {
    return roadDetailLayerDefinitions.map((layer) => {
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

export const roadDetailLayerDefinitions = [
    {
        id: 'gore_areas',
        type: 'fill',
        filter: featureTypeFilter('gore_area'),
        minzoom: 16,
        paint: {
            'fill-color': '#DCE3EA',
            'fill-opacity': 0.38,
            'fill-outline-color': '#F8FAFC',
        },
    },
    {
        id: 'gore_area_hatching',
        type: 'fill',
        filter: featureTypeFilter('gore_area'),
        minzoom: 17,
        paint: {
            'fill-pattern': 'road-detail-gore-hatch',
            'fill-opacity': 0.34,
        },
    },
    {
        id: 'road_surfaces',
        type: 'line',
        filter: featureTypeFilter('road_centerline'),
        minzoom: 16.2,
        layout: {
            'line-cap': 'butt',
            'line-join': 'round',
        },
        paint: {
            'line-color': '#EFF4F8',
            'line-width': [
                'interpolate',
                ['linear'],
                ['zoom'],
                16.2,
                ['*', ['coalesce', ['to-number', ['get', 'lanes_total']], 2], 2.4],
                18,
                ['*', ['coalesce', ['to-number', ['get', 'lanes_total']], 2], 4.4],
                20,
                ['*', ['coalesce', ['to-number', ['get', 'lanes_total']], 2], 6.2],
            ],
            'line-opacity': 0.22,
        },
    },
    {
        id: 'road_centerlines',
        type: 'line',
        filter: featureTypeFilter('road_centerline'),
        minzoom: 16,
        layout: {
            'line-cap': 'butt',
            'line-join': 'round',
        },
        paint: {
            'line-color': '#FFFFFF',
            'line-width': ['interpolate', ['linear'], ['zoom'], 16, 0.55, 18, 0.95, 20, 1.35],
            'line-opacity': 0.16,
        },
    },
    {
        id: 'road_edges',
        type: 'line',
        filter: featureTypeFilter('road_edge'),
        minzoom: 17.6,
        layout: {
            'line-cap': 'butt',
            'line-join': 'round',
        },
        paint: {
            'line-color': '#F8FAFC',
            'line-width': ['interpolate', ['linear'], ['zoom'], 16, 0.55, 18, 1.05, 20, 1.45],
            'line-opacity': 0.26,
            'line-offset': lineOffset,
        },
    },
    {
        id: 'road_lanes',
        type: 'line',
        filter: ['all', featureTypeFilter('road_lane'), explicitLaneDetailFilter],
        minzoom: 18.6,
        layout: {
            'line-cap': 'butt',
            'line-join': 'round',
        },
        paint: {
            'line-color': [
                'match',
                ['get', 'lane_type'],
                'turn_only',
                '#EAF0F5',
                'bike',
                '#B6D6C9',
                '#D8E2F0',
            ],
            'line-width': ['interpolate', ['linear'], ['zoom'], 16, 0.6, 18, 1.35, 20, 2.15],
            'line-opacity': 0.14,
            'line-offset': lineOffset,
        },
    },
    {
        id: 'parking_lanes',
        type: 'line',
        filter: featureTypeFilter('parking_lane'),
        minzoom: 17,
        layout: {
            'line-cap': 'round',
            'line-join': 'round',
        },
        paint: {
            'line-color': '#A7B6C8',
            'line-width': ['interpolate', ['linear'], ['zoom'], 17, 1.1, 19, 2.2],
            'line-opacity': 0.34,
            'line-offset': lineOffset,
            'line-dasharray': [1.4, 1.4],
        },
    },
    {
        id: 'bus_lanes',
        type: 'line',
        filter: ['any', featureTypeFilter('bus_lane'), ['all', featureTypeFilter('road_lane'), ['==', ['get', 'lane_type'], 'bus']]],
        minzoom: 18.6,
        layout: {
            'line-cap': 'butt',
            'line-join': 'round',
        },
        paint: {
            'line-color': '#78B7C8',
            'line-width': ['interpolate', ['linear'], ['zoom'], 16.5, 1.2, 18, 2.2, 20, 3],
            'line-opacity': 0.3,
            'line-offset': lineOffset,
        },
    },
    {
        id: 'lane_markings_solid',
        type: 'line',
        filter: [
            'all',
            featureTypeFilter('lane_marking'),
            explicitLaneMarkingFilter,
            ['!=', ['get', 'marking_type'], 'dashed'],
            ['!=', ['get', 'marking_type'], 'bus_lane_marking'],
        ],
        minzoom: 18.6,
        layout: {
            'line-cap': 'butt',
            'line-join': 'round',
        },
        paint: {
            'line-color': ['match', ['get', 'color'], 'yellow', '#E5D79B', '#F8FAFC'],
            'line-width': ['interpolate', ['linear'], ['zoom'], 17, 0.75, 19, 1.25],
            'line-opacity': 0.44,
            'line-offset': lineOffset,
        },
    },
    {
        id: 'lane_markings_dashed',
        type: 'line',
        filter: [
            'all',
            featureTypeFilter('lane_marking'),
            explicitLaneMarkingFilter,
            ['==', ['get', 'marking_type'], 'dashed'],
        ],
        minzoom: 18.6,
        layout: {
            'line-cap': 'butt',
            'line-join': 'round',
        },
        paint: {
            'line-color': ['match', ['get', 'color'], 'yellow', '#E5D79B', '#F8FAFC'],
            'line-width': ['interpolate', ['linear'], ['zoom'], 17, 0.75, 19, 1.25],
            'line-opacity': 0.36,
            'line-offset': lineOffset,
            'line-dasharray': [3.2, 3],
        },
    },
    {
        id: 'lane_markings_bus',
        type: 'line',
        filter: [
            'all',
            featureTypeFilter('lane_marking'),
            explicitLaneMarkingFilter,
            ['==', ['get', 'marking_type'], 'bus_lane_marking'],
        ],
        minzoom: 18.6,
        layout: {
            'line-cap': 'butt',
            'line-join': 'round',
        },
        paint: {
            'line-color': '#F8FAFC',
            'line-width': ['interpolate', ['linear'], ['zoom'], 17, 0.8, 19, 1.35],
            'line-opacity': 0.68,
            'line-offset': lineOffset,
            'line-dasharray': [1.2, 1.4],
        },
    },
    {
        id: 'turn_arrows',
        type: 'symbol',
        filter: ['all', featureTypeFilter('turn_arrow'), explicitLaneDetailFilter],
        minzoom: 18.8,
        layout: {
            'text-field': [
                'match',
                ['get', 'turn'],
                'left',
                '←',
                'right',
                '→',
                'slight_left',
                '↖',
                'slight_right',
                '↗',
                'through_left',
                '↰',
                'through_right',
                '↱',
                'u_turn',
                '↶',
                'through',
                '↑',
                '',
            ],
            'text-font': ['Noto Sans Bold'],
            'text-size': ['interpolate', ['linear'], ['zoom'], 17.5, 13, 19, 18, 20, 22],
            'text-rotate': ['coalesce', ['to-number', ['get', 'bearing']], 0],
            'text-rotation-alignment': 'map',
            'text-pitch-alignment': 'map',
            'text-keep-upright': false,
            'text-allow-overlap': false,
            'text-ignore-placement': false,
            'text-offset': ['literal', [0, 0]],
        },
        paint: {
            'text-color': '#F8FAFC',
            'text-halo-color': 'rgba(16, 32, 51, 0.42)',
            'text-halo-width': 1.1,
            'text-opacity': 0.8,
        },
    },
    {
        id: 'crosswalks',
        type: 'line',
        filter: featureTypeFilter('crosswalk'),
        minzoom: 17,
        layout: {
            'line-cap': 'butt',
            'line-join': 'round',
        },
        paint: {
            'line-color': '#F9FBFD',
            'line-width': ['interpolate', ['linear'], ['zoom'], 17, 4.5, 19, 7.5],
            'line-opacity': 0.72,
            'line-dasharray': [0.55, 0.55],
        },
    },
    {
        id: 'stop_lines',
        type: 'line',
        filter: featureTypeFilter('stop_line'),
        minzoom: 17,
        layout: {
            'line-cap': 'butt',
            'line-join': 'round',
        },
        paint: {
            'line-color': '#F8FAFC',
            'line-width': ['interpolate', ['linear'], ['zoom'], 17, 2.2, 19, 3.2],
            'line-opacity': 0.82,
        },
    },
    {
        id: 'traffic_calming',
        type: 'line',
        filter: featureTypeFilter('traffic_calming'),
        minzoom: 18,
        layout: {
            'line-cap': 'round',
            'line-join': 'round',
        },
        paint: {
            'line-color': '#D7C892',
            'line-width': ['interpolate', ['linear'], ['zoom'], 18, 2.2, 20, 3.6],
            'line-opacity': 0.66,
            'line-dasharray': [0.7, 0.9],
        },
    },
    {
        id: 'traffic_islands',
        type: 'fill',
        filter: featureTypeFilter('traffic_island'),
        minzoom: 17,
        paint: {
            'fill-color': '#D5DBDF',
            'fill-opacity': 0.58,
            'fill-outline-color': '#F8FAFC',
        },
    },
];
