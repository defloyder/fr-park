import maplibregl from 'maplibre-gl';
import {
    fetchDrivingRoute as fetchYandexDrivingRoute,
    fetchFuelStations,
    fetchParkingSpots,
    reverseGeocode,
} from './parking-api';
import { getClosestRouteProjection, isManualMapInteraction } from './navigation-logic';
import { addRoadDetails } from '../utils/map/addRoadDetails';

let map = null;
let parkingSpotsLoadPromise = null;
let spotsCache = [];
let pendingMarker = null;
let addressRequestId = 0;
let userLocationRenderFrame = null;
let renderedUserLocation = null;
let targetUserLocation = null;
let isPickingMode = false;
let isRouteDestinationPickingMode = false;
let isTrafficSuppressedByRoute = false;
let isTrafficForcedVisibleByUser = false;
let routeManeuverMarker = null;
let routeManeuverCoordinate = null;
let fuelStationsLoadTimer = null;
let fuelStationsRequestId = 0;
let fuelStationsAbortController = null;
let fuelStationsRetryTimer = null;
let fuelStationsCache = new Map();
let renderedFuelStationIds = new Set();
let fuelStationPopup = null;
let isFuelLayerEnabled = false;

const MOSCOW_CENTER = [37.6173, 55.7558];
const MAP_CONTAINER_ID = 'parking-map';
const SOURCE_ID = 'parking-spots';
const PENDING_SOURCE_ID = 'pending-parking-spot';
const USER_LOCATION_SOURCE_ID = 'user-location';
const ROUTE_SOURCE_ID = 'active-route';
const SPEED_CAMERA_SOURCE_ID = 'speed-cameras';
const FUEL_STATION_SOURCE_ID = 'fuel-stations';
const FUEL_STATION_MIN_ZOOM = 8.5;
const FUEL_STATION_CACHE_TTL_MS = 5 * 60 * 1000;
const FUEL_STATION_CACHE_LIMIT = 12;
const PERSONAL_PLACE_SOURCE_ID = 'personal-places';
const TRAFFIC_FLOW_SOURCE_ID = 'tomtom-traffic-flow';
const TRAFFIC_FLOW_LAYER_ID = 'tomtom-traffic-flow';
const ROUTE_CASING_LAYER_ID = 'active-route-casing';
const ROUTE_GLOW_LAYER_ID = 'active-route-glow';
const ROUTE_LINE_LAYER_ID = 'active-route-line';
const ROUTE_HIGHLIGHT_LAYER_ID = 'active-route-highlight';
const ROAD_SOURCE_ID = 'openfreemap-vector';
const ENABLE_ROAD_DETAILS = true;
const POI_ICON_IMAGE_IDS = {
    metro: 'poi-metro',
    landmark: 'poi-landmark',
    hospital: 'poi-hospital',
    fuel: 'poi-fuel',
};
const USER_LOCATION_ICON_OPTIONS = [
    { id: 'auralith', label: 'Auralith', svg: createUserLocationSvg },
    { id: 'redbull-f1', label: 'Red Bull F1', svg: createRedBullF1Svg },
    { id: 'ferrari-f1', label: 'Ferrari F1', svg: createFerrariF1Svg },
    { id: 'plane', label: 'Самолет', svg: createPlaneSvg },
    { id: 'helicopter', label: 'Вертолет', svg: createHelicopterSvg },
    { id: 'buran', label: 'Буран', svg: createBuranSvg },
];
const BASE_LAYER_IDS = ['light', 'dark', 'satellite'];
const DEFAULT_BASE_LAYER_ID = 'light';
const BASE_LAYER_STORAGE_KEY = 'auralith:map-layer';
const ROUTE_CACHE_STORAGE_KEY = 'auralith:last-driving-route';
const TRAFFIC_LAYER_STORAGE_KEY = 'auralith:traffic-enabled';
const FUEL_LAYER_STORAGE_KEY = 'auralith:fuel-layer-enabled';
const USER_LOCATION_ICON_STORAGE_KEY = 'auralith:user-location-icon';
const USER_LOCATION_ICON_PREFIX = 'user-location-';
const ROAD_MARKING_LAYER_PATTERNS = [
    /^road_marking_/,
    /^base_road_lane_marking_/,
    /^base_road_center_/,
    /^base_road_.*_edge_/,
    /^lane_markings_/,
    /^turn_arrows$/,
    /^crosswalks$/,
    /^stop_lines$/,
    /^traffic_calming$/,
    /^traffic_islands$/,
    /^gore_areas$/,
    /^gore_area_hatching$/,
    /^road_lanes$/,
    /^parking_lanes$/,
    /^bus_lanes$/,
    /^road_edges$/,
    /^road_centerlines$/,
    /^road_surfaces$/,
];
const ROAD_MARKING_SOURCE_IDS = ['road-markings', 'road-details'];
const FOLLOW_ZOOM = 17.75;
const FOLLOW_PITCH = 68;
const FOLLOW_SCREEN_OFFSET_RATIO = 0.24;
const FOLLOW_CENTER_LOOKAHEAD_METERS = 12;
const FOLLOW_BEARING_LOOKAHEAD_METERS = 45;
const ROAD_CLASS_WIDTH_FACTOR = [
    'match',
    ['get', 'class'],
    'motorway',
    1,
    'trunk',
    0.95,
    'primary',
    0.85,
    'secondary',
    0.72,
    0.58,
];
const ROAD_BASE_FADE_OPACITY = (peak = 0.96) => [
    'interpolate',
    ['linear'],
    ['zoom'],
    15.2,
    peak,
    16,
    peak * 0.55,
    16.8,
    peak * 0.08,
    17.2,
    0,
];
const ROAD_LEGACY_DETAIL_OPACITY = (peak = 0.96) => [
    'interpolate',
    ['linear'],
    ['zoom'],
    13.4,
    peak,
    14.2,
    peak * 0.28,
    14.8,
    0,
];

const ROUTE_TRAFFIC_LINE_COLOR = [
    'match',
    ['get', 'traffic'],
    'jam',
    '#F43F5E',
    'heavy',
    '#FF7A18',
    'slow',
    '#F7C948',
    'free',
    '#3478F6',
    '#635BFF',
];

const MAP_STYLE = {
    version: 8,
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    sources: {
        'basemap-satellite': {
            type: 'raster',
            tiles: [
                'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
            ],
            tileSize: 256,
            maxzoom: 17,
            attribution: 'Tiles (c) Esri',
        },
        [ROAD_SOURCE_ID]: {
            type: 'vector',
            url: 'https://tiles.openfreemap.org/planet',
            attribution: '(c) OpenFreeMap (c) OpenMapTiles (c) OpenStreetMap contributors',
        },
    },
    layers: [
        {
            id: 'basemap-satellite',
            type: 'raster',
            source: 'basemap-satellite',
            layout: {
                visibility: 'none',
            },
            paint: {
                'raster-opacity': 0.96,
                'raster-saturation': 0.02,
                'raster-contrast': 0.06,
            },
        },
        {
            id: 'vector-background',
            type: 'background',
            paint: {
                'background-color': '#F4F3ED',
            },
        },
        {
            id: 'water-fill',
            type: 'fill',
            source: ROAD_SOURCE_ID,
            'source-layer': 'water',
            paint: {
                'fill-color': '#B9E3F2',
                'fill-opacity': 1,
            },
        },
        {
            id: 'waterway-line',
            type: 'line',
            source: ROAD_SOURCE_ID,
            'source-layer': 'waterway',
            minzoom: 10,
            layout: {
                'line-cap': 'round',
                'line-join': 'round',
            },
            paint: {
                'line-color': '#9BD6EA',
                'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.6, 15, 2.2, 18, 4.6],
                'line-opacity': 0.9,
            },
        },
        {
            id: 'park-fill',
            type: 'fill',
            source: ROAD_SOURCE_ID,
            'source-layer': 'park',
            paint: {
                'fill-color': '#CBE7BF',
                'fill-opacity': 0.96,
            },
        },
        {
            id: 'landuse-fill',
            type: 'fill',
            source: ROAD_SOURCE_ID,
            'source-layer': 'landuse',
            minzoom: 10,
            paint: {
                'fill-color': '#ECEDE7',
                'fill-opacity': 0.62,
            },
        },
        {
            id: 'landcover-wood',
            type: 'fill',
            source: ROAD_SOURCE_ID,
            'source-layer': 'landcover',
            minzoom: 7,
            filter: ['in', ['get', 'class'], ['literal', ['wood', 'forest']]],
            paint: {
                'fill-color': '#BFDDAE',
                'fill-opacity': ['interpolate', ['linear'], ['zoom'], 7, 0.72, 13, 0.9],
            },
        },
        {
            id: 'landcover-grass',
            type: 'fill',
            source: ROAD_SOURCE_ID,
            'source-layer': 'landcover',
            minzoom: 9,
            filter: ['in', ['get', 'class'], ['literal', ['grass', 'meadow', 'scrub']]],
            paint: {
                'fill-color': '#D8ECCB',
                'fill-opacity': 0.82,
            },
        },
        {
            id: 'landcover-wetland',
            type: 'fill',
            source: ROAD_SOURCE_ID,
            'source-layer': 'landcover',
            minzoom: 10,
            filter: ['in', ['get', 'class'], ['literal', ['wetland', 'reed']]],
            paint: {
                'fill-color': '#CBE5CE',
                'fill-opacity': 0.68,
            },
        },
        {
            id: 'landuse-green',
            type: 'fill',
            source: ROAD_SOURCE_ID,
            'source-layer': 'landuse',
            minzoom: 10,
            filter: ['in', ['get', 'class'], ['literal', [
                'park',
                'garden',
                'grass',
                'cemetery',
                'recreation_ground',
                'pitch',
                'golf_course',
                'allotments',
            ]]],
            paint: {
                'fill-color': [
                    'match',
                    ['get', 'class'],
                    'cemetery',
                    '#D5E6C9',
                    ['pitch', 'recreation_ground'],
                    '#D9EFC8',
                    '#CFE8BE',
                ],
                'fill-opacity': 0.9,
            },
        },
        {
            id: 'landuse-residential',
            type: 'fill',
            source: ROAD_SOURCE_ID,
            'source-layer': 'landuse',
            minzoom: 11,
            filter: ['in', ['get', 'class'], ['literal', ['residential', 'suburb', 'neighbourhood']]],
            paint: {
                'fill-color': '#F0EFEB',
                'fill-opacity': 0.7,
            },
        },
        {
            id: 'landuse-civic',
            type: 'fill',
            source: ROAD_SOURCE_ID,
            'source-layer': 'landuse',
            minzoom: 12,
            filter: ['in', ['get', 'class'], ['literal', ['hospital', 'school', 'university', 'college']]],
            paint: {
                'fill-color': [
                    'match',
                    ['get', 'class'],
                    'hospital',
                    '#F6DDD9',
                    '#E8E3F5',
                ],
                'fill-opacity': 0.78,
            },
        },
        {
            id: 'boundary-line',
            type: 'line',
            source: ROAD_SOURCE_ID,
            'source-layer': 'boundary',
            minzoom: 8,
            paint: {
                'line-color': 'rgba(71, 85, 105, 0.26)',
                'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.7, 14, 1.4],
                'line-dasharray': [3, 2],
            },
        },
        {
            id: 'building-footprint',
            type: 'fill',
            source: ROAD_SOURCE_ID,
            'source-layer': 'building',
            minzoom: 12.5,
            paint: {
                'fill-color': '#D9DDD8',
                'fill-outline-color': '#C7CDC7',
                'fill-opacity': ['interpolate', ['linear'], ['zoom'], 12.5, 0.3, 15, 0.78],
            },
        },
        {
            id: 'building-3d',
            type: 'fill-extrusion',
            source: ROAD_SOURCE_ID,
            'source-layer': 'building',
            minzoom: 14,
            paint: {
                'fill-extrusion-color': '#D2D8D3',
                'fill-extrusion-height': [
                    'interpolate',
                    ['linear'],
                    ['zoom'],
                    14,
                    0,
                    15,
                    ['to-number', ['get', 'render_height'], ['get', 'height'], 14],
                ],
                'fill-extrusion-base': ['to-number', ['get', 'render_min_height'], ['get', 'min_height'], 0],
                'fill-extrusion-opacity': 0.78,
                'fill-extrusion-vertical-gradient': true,
            },
        },
        {
            id: 'rail-casing',
            type: 'line',
            source: ROAD_SOURCE_ID,
            'source-layer': 'transportation',
            minzoom: 11,
            filter: ['in', ['get', 'class'], ['literal', ['rail', 'transit']]],
            layout: {
                'line-cap': 'round',
                'line-join': 'round',
            },
            paint: {
                'line-color': '#FFFFFF',
                'line-width': ['interpolate', ['linear'], ['zoom'], 11, 1.8, 16, 4.4],
                'line-opacity': 0.9,
            },
        },
        {
            id: 'rail-line',
            type: 'line',
            source: ROAD_SOURCE_ID,
            'source-layer': 'transportation',
            minzoom: 11,
            filter: ['in', ['get', 'class'], ['literal', ['rail', 'transit']]],
            layout: {
                'line-cap': 'butt',
                'line-join': 'round',
            },
            paint: {
                'line-color': '#A7ADB3',
                'line-width': ['interpolate', ['linear'], ['zoom'], 11, 0.8, 16, 1.8],
                'line-dasharray': [2, 1.5],
                'line-opacity': 0.82,
            },
        },
        {
            id: 'road-path',
            type: 'line',
            source: ROAD_SOURCE_ID,
            'source-layer': 'transportation',
            minzoom: 13,
            filter: ['in', ['get', 'class'], ['literal', ['path', 'track']]],
            layout: {
                'line-cap': 'round',
                'line-join': 'round',
            },
            paint: {
                'line-color': '#C9CDC5',
                'line-width': ['interpolate', ['linear'], ['zoom'], 13, 0.7, 17, 2.2],
                'line-dasharray': [1.5, 1.2],
                'line-opacity': 0.82,
            },
        },
        {
            id: 'road-casing-minor',
            type: 'line',
            source: ROAD_SOURCE_ID,
            'source-layer': 'transportation',
            minzoom: 11,
            filter: ['in', ['get', 'class'], ['literal', ['minor', 'service']]],
            layout: {
                'line-cap': 'round',
                'line-join': 'round',
            },
            paint: {
                'line-color': '#B8C1CC',
                'line-width': ['interpolate', ['linear'], ['zoom'], 11, 1.6, 15, 7, 18, 16],
                'line-opacity': ROAD_LEGACY_DETAIL_OPACITY(0.92),
            },
        },
        {
            id: 'road-casing-major',
            type: 'line',
            source: ROAD_SOURCE_ID,
            'source-layer': 'transportation',
            minzoom: 8,
            filter: ['in', ['get', 'class'], ['literal', ['motorway', 'trunk', 'primary', 'secondary', 'tertiary']]],
            layout: {
                'line-cap': 'round',
                'line-join': 'round',
            },
            paint: {
                'line-color': '#AEB8C5',
                'line-width': [
                    'interpolate',
                    ['linear'],
                    ['zoom'],
                    8,
                    ['*', 2, ROAD_CLASS_WIDTH_FACTOR],
                    13,
                    ['*', 9, ROAD_CLASS_WIDTH_FACTOR],
                    15,
                    ['*', 18, ROAD_CLASS_WIDTH_FACTOR],
                    16,
                    ['*', 28, ROAD_CLASS_WIDTH_FACTOR],
                    17,
                    ['*', 42, ROAD_CLASS_WIDTH_FACTOR],
                    18,
                    ['*', 62, ROAD_CLASS_WIDTH_FACTOR],
                    19,
                    ['*', 92, ROAD_CLASS_WIDTH_FACTOR],
                    20,
                    ['*', 136, ROAD_CLASS_WIDTH_FACTOR],
                ],
                'line-opacity': ROAD_LEGACY_DETAIL_OPACITY(0.94),
            },
        },
        {
            id: 'road-minor',
            type: 'line',
            source: ROAD_SOURCE_ID,
            'source-layer': 'transportation',
            minzoom: 11,
            filter: ['in', ['get', 'class'], ['literal', ['minor', 'service']]],
            layout: {
                'line-cap': 'round',
                'line-join': 'round',
            },
            paint: {
                'line-color': '#D4DAE2',
                'line-width': ['interpolate', ['linear'], ['zoom'], 11, 1, 15, 6, 18, 14],
                'line-opacity': ROAD_LEGACY_DETAIL_OPACITY(0.96),
            },
        },
        {
            id: 'road-major',
            type: 'line',
            source: ROAD_SOURCE_ID,
            'source-layer': 'transportation',
            minzoom: 8,
            filter: ['in', ['get', 'class'], ['literal', ['motorway', 'trunk', 'primary', 'secondary', 'tertiary']]],
            layout: {
                'line-cap': 'round',
                'line-join': 'round',
            },
            paint: {
                'line-color': [
                    'match',
                    ['get', 'class'],
                    'motorway',
                    '#B9C4D1',
                    'trunk',
                    '#C1CBD6',
                    'primary',
                    '#CBD3DD',
                    '#D8DEE6',
                ],
                'line-width': [
                    'interpolate',
                    ['linear'],
                    ['zoom'],
                    8,
                    ['*', 1.2, ROAD_CLASS_WIDTH_FACTOR],
                    13,
                    ['*', 7, ROAD_CLASS_WIDTH_FACTOR],
                    15,
                    ['*', 14, ROAD_CLASS_WIDTH_FACTOR],
                    16,
                    ['*', 23, ROAD_CLASS_WIDTH_FACTOR],
                    17,
                    ['*', 36, ROAD_CLASS_WIDTH_FACTOR],
                    18,
                    ['*', 55, ROAD_CLASS_WIDTH_FACTOR],
                    19,
                    ['*', 84, ROAD_CLASS_WIDTH_FACTOR],
                    20,
                    ['*', 126, ROAD_CLASS_WIDTH_FACTOR],
                ],
                'line-opacity': ROAD_LEGACY_DETAIL_OPACITY(0.96),
            },
        },
        {
            id: 'place-label',
            type: 'symbol',
            source: ROAD_SOURCE_ID,
            'source-layer': 'place',
            minzoom: 5,
            layout: {
                'text-field': ['coalesce', ['get', 'name:ru'], ['get', 'name']],
                'text-font': ['Noto Sans Regular'],
                'text-size': ['interpolate', ['linear'], ['zoom'], 5, 11, 12, 16],
                'text-rotation-alignment': 'viewport',
                'text-pitch-alignment': 'viewport',
                'text-allow-overlap': false,
            },
            paint: {
                'text-color': '#475569',
                'text-halo-color': 'rgba(255, 255, 255, 0.94)',
                'text-halo-width': 1.8,
                'text-opacity': 0.96,
            },
        },
        {
            id: 'road-name',
            type: 'symbol',
            source: ROAD_SOURCE_ID,
            'source-layer': 'transportation_name',
            minzoom: 12,
            layout: {
                'symbol-placement': 'line',
                'text-field': ['coalesce', ['get', 'name:ru'], ['get', 'name']],
                'text-font': ['Noto Sans Regular'],
                'text-size': ['interpolate', ['linear'], ['zoom'], 12, 10, 16, 13],
                'text-rotation-alignment': 'map',
                'text-pitch-alignment': 'viewport',
                'text-keep-upright': true,
                'symbol-spacing': ['interpolate', ['linear'], ['zoom'], 12, 460, 17, 260],
                'text-allow-overlap': false,
            },
            paint: {
                'text-color': '#364152',
                'text-halo-color': 'rgba(255, 255, 255, 0.96)',
                'text-halo-width': 2.2,
                'text-opacity': 1,
            },
        },
        {
            id: 'transit-labels',
            type: 'symbol',
            source: ROAD_SOURCE_ID,
            'source-layer': 'poi',
            minzoom: 13,
            filter: [
                'match',
                ['coalesce', ['get', 'class'], ['get', 'subclass']],
                ['subway', 'railway', 'station', 'train_station', 'halt', 'bus_stop', 'tram_stop', 'platform', 'public_transport'],
                true,
                false,
            ],
            layout: {
                'icon-image': POI_ICON_IMAGE_IDS.metro,
                'icon-size': ['interpolate', ['linear'], ['zoom'], 13, 0.72, 17, 1],
                'text-field': ['coalesce', ['get', 'name:ru'], ['get', 'name'], 'Метро'],
                'text-font': ['Noto Sans Bold'],
                'text-size': ['interpolate', ['linear'], ['zoom'], 13, 10, 16, 12, 18, 13],
                'text-radial-offset': 0.72,
                'text-variable-anchor': ['top', 'bottom', 'left', 'right'],
                'text-max-width': 10,
                'icon-allow-overlap': false,
                'text-allow-overlap': false,
            },
            paint: {
                'icon-opacity': 0.98,
                'text-color': '#2563EB',
                'text-halo-color': 'rgba(255, 255, 255, 0.98)',
                'text-halo-width': 2,
                'text-opacity': 1,
            },
        },
        {
            id: 'poi-icons',
            type: 'symbol',
            source: ROAD_SOURCE_ID,
            'source-layer': 'poi',
            minzoom: 14,
            filter: [
                'match',
                ['coalesce', ['get', 'class'], ['get', 'subclass']],
                [
                    'attraction',
                    'monument',
                    'museum',
                    'hospital',
                    'fuel',
                ],
                true,
                false,
            ],
            layout: {
                'icon-image': [
                    'match',
                    ['coalesce', ['get', 'class'], ['get', 'subclass']],
                    ['hospital'],
                    POI_ICON_IMAGE_IDS.hospital,
                    ['fuel'],
                    POI_ICON_IMAGE_IDS.fuel,
                    ['attraction', 'monument', 'museum'],
                    POI_ICON_IMAGE_IDS.landmark,
                    POI_ICON_IMAGE_IDS.landmark,
                ],
                'text-field': [
                    'coalesce',
                    ['get', 'name:ru'],
                    ['get', 'name'],
                    [
                        'match',
                        ['coalesce', ['get', 'class'], ['get', 'subclass']],
                        ['hospital'],
                        'Больница',
                        ['fuel'],
                        'АЗС',
                        ['attraction', 'monument', 'museum'],
                        'Ориентир',
                        '',
                    ],
                ],
                'text-font': ['Noto Sans Regular'],
                'text-size': ['interpolate', ['linear'], ['zoom'], 14, 9.5, 16, 11, 18, 12],
                'text-radial-offset': ['interpolate', ['linear'], ['zoom'], 14, 0.62, 17, 0.82],
                'text-variable-anchor': ['top', 'bottom', 'left', 'right'],
                'text-justify': 'auto',
                'text-max-width': 9,
                'icon-size': ['interpolate', ['linear'], ['zoom'], 14, 0.72, 17, 1],
                'icon-allow-overlap': false,
                'icon-ignore-placement': false,
                'text-allow-overlap': false,
                'text-ignore-placement': false,
            },
            paint: {
                'icon-opacity': 0.92,
                'text-color': '#334155',
                'text-halo-color': 'rgba(255, 255, 255, 0.96)',
                'text-halo-width': 1.8,
                'text-opacity': 0.94,
            },
        },
        {
            id: 'house-number',
            type: 'symbol',
            source: ROAD_SOURCE_ID,
            'source-layer': 'housenumber',
            minzoom: 17,
            layout: {
                'text-field': ['coalesce', ['get', 'housenumber'], ['get', 'addr:housenumber']],
                'text-font': ['Noto Sans Regular'],
                'text-size': ['interpolate', ['linear'], ['zoom'], 17, 9, 19, 11],
                'text-rotation-alignment': 'viewport',
                'text-pitch-alignment': 'viewport',
                'text-allow-overlap': false,
                'text-ignore-placement': false,
            },
            paint: {
                'text-color': '#64748B',
                'text-halo-color': 'rgba(255, 255, 255, 0.94)',
                'text-halo-width': 1.4,
                'text-opacity': 0.82,
            },
        },
    ],
};

const MARKER_IMAGES = {
    verified: ['#7CFFB2', '#00B8A9'],
    unverified: ['#FFD979', '#F59E0B'],
    temporary: ['#B996FF', '#8B5CF6'],
    outdated: ['#FF6D82', '#DC2626'],
    new: ['#8DEEFF', '#00E5FF'],
};
const USER_LOCATION_MARKER_ID = 'user-location-auralith';
const SPEED_CAMERA_MARKER_ID = 'speed-camera-marker';
const FUEL_MARKER_AVAILABLE_ID = 'fuel-marker-available';
const FUEL_MARKER_UNAVAILABLE_ID = 'fuel-marker-unavailable';

export async function initParkingMap() {
    if (!document.getElementById(MAP_CONTAINER_ID)) {
        return;
    }

    if (!isWebGlSupported()) {
        reportMapError('Карта не поддерживается в этом браузере. Попробуйте Chrome или Safari.', true);
        return;
    }

    try {
        initMapLibreMap();
    } catch (error) {
        console.error('Map init failed', error);
        reportMapError('Не удалось загрузить карту. Проверьте соединение и обновите страницу.', true);
    }
}

function reportMapError(message, mapUnavailable = false) {
    window.dispatchEvent(new CustomEvent('parking:error', {
        detail: { message, mapUnavailable },
    }));
}

function isWebGlSupported() {
    try {
        const canvas = document.createElement('canvas');

        return Boolean(
            window.WebGLRenderingContext
                && (canvas.getContext('webgl') || canvas.getContext('experimental-webgl')),
        );
    } catch {
        return false;
    }
}

function initMapLibreMap() {
    document.body.classList.add('is-map-loading');
    document.body.classList.remove('is-map-ready');

    map = new maplibregl.Map({
        container: MAP_CONTAINER_ID,
        center: MOSCOW_CENTER,
        zoom: 11.4,
        minZoom: 3,
        maxZoom: 20,
        attributionControl: false,
        style: MAP_STYLE,
        fadeDuration: 0,
    });

    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');

    map.on('error', (event) => {
        const message = String(event?.error?.message || event?.error || '');

        if (message.includes('Failed to fetch') || message.includes('AJAXError')) {
            console.warn('MapLibre tile/source request failed', message);
            return;
        }

        console.warn('MapLibre error', event.error);
    });

    map.on('styledata', () => {
        removeRoadMarkingLayers();
    });

    bindLayerSwitcher();
    bindTrafficToggle();
    bindMapControlButtons();
    bindMapSettings();
    bindPerformanceMode();

    map.once('load', async () => {
        map.resize();
        setBaseMapLayer(getSavedBaseMapLayer());
        document.body.classList.remove('is-map-loading');
        document.body.classList.add('is-map-ready');

        try {
            await addMarkerImages();
            addPoiIconImages();
            addSpeedCameraImage();
            addFuelMarkerImages();
            addParkingSource();
            addParkingLayers();
            addFuelStationSourceAndLayers();
            addPendingSourceAndLayer();
            addPersonalPlacesSourceAndLayer();
            addUserLocationSourceAndLayer();
            addRouteSourceAndLayer();
            addSpeedCameraSourceAndLayer();
            addTrafficFlowLayer();
            if (ENABLE_ROAD_DETAILS) {
                addRoadDetails(map, {
                    baseRoadSource: ROAD_SOURCE_ID,
                    includeBaseRoadMarkings: false,
                });
            }
            removeRoadMarkingLayers();
            bindMapEvents();
            setFuelLayerEnabled(getSavedFuelLayerState(), { persist: false });
            window.dispatchEvent(new CustomEvent('map:ready'));
        } catch (error) {
            console.error('Map layers failed', error);
            reportMapError('Не удалось отрисовать карту. Обновите страницу.', true);
            return;
        }

        try {
            scheduleParkingSpotsLoad();
        } catch {
            reportMapError('Не удалось загрузить точки. Проверьте соединение и попробуйте снова.');
        }
    });

    window.addEventListener('resize', () => map?.resize());
    window.addEventListener('online', () => {
        if (map?.getSource(SOURCE_ID)) {
            scheduleParkingSpotsLoad();
        }
        if (isFuelLayerEnabled) {
            scheduleFuelStationsLoad(0);
        }
    });
}

function removeRoadMarkingLayers() {
    if (!map) {
        return;
    }

    const layers = map.getStyle()?.layers ?? [];

    for (const layer of [...layers].reverse()) {
        if (!ROAD_MARKING_LAYER_PATTERNS.some((pattern) => pattern.test(layer.id))) {
            continue;
        }

        try {
            if (map.getLayer(layer.id)) {
                map.removeLayer(layer.id);
            }
        } catch {
            // Layer removal can race style updates; the next styledata pass retries.
        }
    }

    for (const sourceId of ROAD_MARKING_SOURCE_IDS) {
        try {
            if (map.getSource(sourceId)) {
                map.removeSource(sourceId);
            }
        } catch {
            // Sources with surviving layers cannot be removed yet.
        }
    }
}

function scheduleParkingSpotsLoad() {
    if (parkingSpotsLoadPromise) {
        return;
    }

    const run = () => {
        parkingSpotsLoadPromise = loadParkingSpots()
            .catch(() => {
                const message = navigator.onLine
                    ? 'Не удалось загрузить парковки. Повторим попытку после восстановления соединения.'
                    : 'Нет подключения к интернету. Карта доступна, парковки загрузятся после восстановления сети.';
                reportMapError(message);
            })
            .finally(() => {
                parkingSpotsLoadPromise = null;
            });
    };

    if ('requestIdleCallback' in window) {
        window.requestIdleCallback(run, { timeout: 1200 });
        return;
    }

    window.setTimeout(run, 180);
}

async function loadParkingSpots() {
    window.dispatchEvent(new CustomEvent('parking:loading'));
    const response = await fetchParkingSpots();
    renderParkingSpots(response.data);
    window.dispatchEvent(new CustomEvent('parking:loaded', { detail: response.data }));
}

function addSpeedCameraSourceAndLayer() {
    map.addSource(SPEED_CAMERA_SOURCE_ID, {
        type: 'geojson',
        data: buildFeatureCollection([]),
    });

    map.addLayer({
        id: 'speed-cameras',
        type: 'symbol',
        source: SPEED_CAMERA_SOURCE_ID,
        layout: {
            'icon-image': SPEED_CAMERA_MARKER_ID,
            'icon-size': ['interpolate', ['linear'], ['zoom'], 10, 0.72, 16, 1],
            'icon-allow-overlap': true,
            'icon-ignore-placement': true,
        },
    });

    map.addLayer({
        id: 'speed-camera-label',
        type: 'symbol',
        source: SPEED_CAMERA_SOURCE_ID,
        minzoom: 13,
        layout: {
            'text-field': ['get', 'label'],
            'text-font': ['Noto Sans Regular'],
            'text-size': ['interpolate', ['linear'], ['zoom'], 13, 10, 16, 12],
            'text-offset': [0, 1.55],
            'text-anchor': 'top',
            'text-rotation-alignment': 'viewport',
            'text-pitch-alignment': 'viewport',
            'text-allow-overlap': false,
        },
        paint: {
            'text-color': '#7F1D1D',
            'text-halo-color': 'rgba(255, 255, 255, 0.92)',
            'text-halo-width': 2,
        },
    });
}

function addSpeedCameraImage() {
    if (map.hasImage(SPEED_CAMERA_MARKER_ID)) return;

    const size = 80;
    const center = size / 2;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d');

    context.clearRect(0, 0, size, size);

    context.shadowColor = 'rgba(15, 23, 42, 0.26)';
    context.shadowBlur = 8;
    context.shadowOffsetY = 3;
    context.beginPath();
    context.arc(center, center, 26, 0, Math.PI * 2);
    context.fillStyle = '#FFFFFF';
    context.fill();
    context.shadowColor = 'transparent';
    context.lineWidth = 8;
    context.strokeStyle = '#EF174A';
    context.stroke();

    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.lineWidth = 3.2;
    context.strokeStyle = '#111827';
    context.strokeRect(26, 31, 28, 17);
    context.beginPath();
    context.moveTo(30, 31);
    context.lineTo(34, 25);
    context.lineTo(46, 25);
    context.lineTo(50, 31);
    context.stroke();
    context.beginPath();
    context.arc(center, 39.5, 5.2, 0, Math.PI * 2);
    context.stroke();

    context.beginPath();
    context.moveTo(21, 34);
    context.lineTo(18, 34);
    context.moveTo(21, 40);
    context.lineTo(17, 40);
    context.moveTo(21, 46);
    context.lineTo(18, 46);
    context.moveTo(59, 34);
    context.lineTo(62, 34);
    context.moveTo(59, 40);
    context.lineTo(63, 40);
    context.moveTo(59, 46);
    context.lineTo(62, 46);
    context.stroke();

    map.addImage(SPEED_CAMERA_MARKER_ID, context.getImageData(0, 0, size, size), { pixelRatio: 2 });
}

function addFuelMarkerImages() {
    addFuelMarkerImage(FUEL_MARKER_AVAILABLE_ID, '#46FFD2', '#00A8FF');
    addFuelMarkerImage(FUEL_MARKER_UNAVAILABLE_ID, '#FF5B78', '#FF174F');
}

function addFuelMarkerImage(imageId, glowColor, coreColor) {
    if (map.hasImage(imageId)) return;

    const size = 112;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d');

    context.clearRect(0, 0, size, size);
    context.save();
    context.shadowColor = glowColor;
    context.shadowBlur = 22;
    context.fillStyle = 'rgba(4, 14, 31, 0.96)';
    context.strokeStyle = glowColor;
    context.lineWidth = 5;
    context.beginPath();
    context.roundRect(22, 13, 60, 76, 17);
    context.fill();
    context.stroke();
    context.restore();

    context.fillStyle = coreColor;
    context.shadowColor = glowColor;
    context.shadowBlur = 11;
    context.beginPath();
    context.roundRect(33, 25, 38, 27, 7);
    context.fill();
    context.shadowColor = 'transparent';

    context.strokeStyle = '#EFFFFF';
    context.lineWidth = 5;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.beginPath();
    context.moveTo(35, 68);
    context.lineTo(69, 68);
    context.moveTo(43, 61);
    context.lineTo(43, 80);
    context.moveTo(63, 61);
    context.lineTo(63, 80);
    context.moveTo(82, 31);
    context.lineTo(94, 43);
    context.lineTo(94, 69);
    context.quadraticCurveTo(94, 80, 84, 80);
    context.lineTo(82, 80);
    context.stroke();

    context.fillStyle = '#FFFFFF';
    context.font = '900 17px sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText('FUEL', 52, 39);

    map.addImage(imageId, context.getImageData(0, 0, size, size), { pixelRatio: 2 });
}

function addFuelStationSourceAndLayers() {
    map.addSource(FUEL_STATION_SOURCE_ID, {
        type: 'geojson',
        data: buildFuelStationFeatureCollection([]),
        cluster: true,
        clusterMaxZoom: 12,
        clusterRadius: 44,
    });

    map.addLayer({
        id: 'fuel-station-cluster-glow',
        type: 'circle',
        source: FUEL_STATION_SOURCE_ID,
        filter: ['has', 'point_count'],
        layout: { visibility: 'none' },
        paint: {
            'circle-radius': ['step', ['get', 'point_count'], 18, 20, 23, 80, 28],
            'circle-color': '#22D3EE',
            'circle-blur': 0.78,
            'circle-opacity': 0.42,
        },
    });

    map.addLayer({
        id: 'fuel-station-cluster',
        type: 'circle',
        source: FUEL_STATION_SOURCE_ID,
        filter: ['has', 'point_count'],
        layout: { visibility: 'none' },
        paint: {
            'circle-radius': ['step', ['get', 'point_count'], 14, 20, 18, 80, 22],
            'circle-color': 'rgba(5, 18, 40, 0.96)',
            'circle-stroke-color': '#46FFD2',
            'circle-stroke-width': 2,
        },
    });

    map.addLayer({
        id: 'fuel-station-cluster-count',
        type: 'symbol',
        source: FUEL_STATION_SOURCE_ID,
        filter: ['has', 'point_count'],
        layout: {
            visibility: 'none',
            'text-field': ['get', 'point_count_abbreviated'],
            'text-font': ['Noto Sans Bold'],
            'text-size': 12,
            'text-allow-overlap': true,
        },
        paint: {
            'text-color': '#EFFFFF',
            'text-halo-color': 'rgba(5, 18, 40, 0.94)',
            'text-halo-width': 1,
        },
    });

    map.addLayer({
        id: 'fuel-station-glow',
        type: 'circle',
        source: FUEL_STATION_SOURCE_ID,
        filter: ['!', ['has', 'point_count']],
        layout: { visibility: 'none' },
        paint: {
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 14, 15, 23],
            'circle-color': '#22D3EE',
            'circle-blur': 0.86,
            'circle-opacity': 0.52,
        },
    });

    map.addLayer({
        id: 'fuel-station-pin',
        type: 'symbol',
        source: FUEL_STATION_SOURCE_ID,
        filter: ['!', ['has', 'point_count']],
        layout: {
            visibility: 'none',
            'icon-image': FUEL_MARKER_AVAILABLE_ID,
            'icon-size': ['interpolate', ['linear'], ['zoom'], 9, 0.58, 14, 0.82, 18, 1],
            'icon-anchor': 'bottom',
            'icon-allow-overlap': true,
            'icon-ignore-placement': true,
        },
    });

    map.addLayer({
        id: 'fuel-station-price',
        type: 'symbol',
        source: FUEL_STATION_SOURCE_ID,
        filter: ['!', ['has', 'point_count']],
        minzoom: 11,
        layout: {
            visibility: 'none',
            'text-field': ['get', 'priceLabel'],
            'text-font': ['Noto Sans Bold'],
            'text-size': ['interpolate', ['linear'], ['zoom'], 11, 10, 16, 12],
            'text-offset': [0, 0.65],
            'text-anchor': 'top',
            'text-allow-overlap': false,
            'text-optional': true,
        },
        paint: {
            'text-color': '#E6FFFF',
            'text-halo-color': 'rgba(3, 10, 24, 0.94)',
            'text-halo-width': 2.4,
        },
    });
}

export function renderSpeedCameras(cameras = []) {
    const features = cameras
        .map((camera) => {
            const longitude = Number(camera.longitude);
            const latitude = Number(camera.latitude);
            const bearing = Number(camera.bearing);

            if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
                return null;
            }

            return {
                type: 'Feature',
                properties: {
                    id: String(camera.id ?? `${longitude}:${latitude}`),
                    title: camera.title ?? 'Камера',
                    label: camera.label ?? 'Камера',
                    bearing: Number.isFinite(bearing) ? bearing : 0,
                    isDummy: Boolean(camera.isDummy),
                },
                geometry: {
                    type: 'Point',
                    coordinates: [longitude, latitude],
                },
            };
        })
        .filter(Boolean);

    map?.getSource(SPEED_CAMERA_SOURCE_ID)?.setData({
        type: 'FeatureCollection',
        features,
    });
}

function bindLayerSwitcher() {
    const switcher = document.querySelector('[data-layer-switcher]');
    const trigger = switcher?.querySelector('[data-map-layer-toggle]');
    const panel = switcher?.querySelector('[data-map-layer-panel]');

    if (!switcher || !trigger || !panel) {
        return;
    }

    setBaseMapLayer(getSavedBaseMapLayer(), { persist: false });

    trigger.addEventListener('click', () => {
        const isOpen = switcher.classList.toggle('is-open');
        trigger.setAttribute('aria-expanded', String(isOpen));
    });

    switcher.querySelectorAll('[data-map-layer]').forEach((button) => {
        button.addEventListener('click', () => {
            setBaseMapLayer(button.dataset.mapLayer, { persist: true });
            switcher.classList.remove('is-open');
            trigger.setAttribute('aria-expanded', 'false');
        });
    });

    switcher.querySelector('[data-fuel-layer-toggle]')?.addEventListener('click', (event) => {
        setFuelLayerEnabled(!isFuelLayerEnabled, { persist: true });
        event.currentTarget.setAttribute('aria-pressed', String(isFuelLayerEnabled));
        switcher.classList.remove('is-open');
        trigger.setAttribute('aria-expanded', 'false');
    });

    document.addEventListener('click', (event) => {
        if (switcher.contains(event.target)) {
            return;
        }

        switcher.classList.remove('is-open');
        trigger.setAttribute('aria-expanded', 'false');
    });
}

function getSavedFuelLayerState() {
    return window.localStorage?.getItem(FUEL_LAYER_STORAGE_KEY) === 'true';
}

function setFuelLayerEnabled(enabled, { persist = false } = {}) {
    isFuelLayerEnabled = Boolean(enabled);
    const visibility = isFuelLayerEnabled ? 'visible' : 'none';
    const parkingVisibility = isFuelLayerEnabled ? 'none' : 'visible';

    [
        'fuel-station-cluster-glow',
        'fuel-station-cluster',
        'fuel-station-cluster-count',
        'fuel-station-glow',
        'fuel-station-pin',
        'fuel-station-price',
    ].forEach((layerId) => {
        if (map?.getLayer(layerId)) {
            map.setLayoutProperty(layerId, 'visibility', visibility);
        }
    });
    ['clusters', 'spots-pin', 'cluster-count'].forEach((layerId) => {
        if (map?.getLayer(layerId)) {
            map.setLayoutProperty(layerId, 'visibility', parkingVisibility);
        }
    });

    document.body.classList.toggle('is-fuel-layer', isFuelLayerEnabled);
    const button = document.querySelector('[data-fuel-layer-toggle]');
    button?.classList.toggle('is-active', isFuelLayerEnabled);
    button?.setAttribute('aria-pressed', String(isFuelLayerEnabled));
    updateFuelLayerMenuState(isFuelLayerEnabled ? 'loading' : 'off');

    if (persist) {
        window.localStorage?.setItem(FUEL_LAYER_STORAGE_KEY, String(isFuelLayerEnabled));
    }

    if (isFuelLayerEnabled) {
        document.getElementById('selected-spot-card')?.classList.add('hidden');
        closeFuelStationPopup();
        window.dispatchEvent(new CustomEvent('fuel-layer:changed', { detail: { enabled: true } }));
        scheduleFuelStationsLoad(0);
    } else {
        window.clearTimeout(fuelStationsLoadTimer);
        window.clearTimeout(fuelStationsRetryTimer);
        fuelStationsLoadTimer = null;
        fuelStationsRetryTimer = null;
        fuelStationsRequestId += 1;
        fuelStationsAbortController?.abort('disabled');
        fuelStationsAbortController = null;
        closeFuelStationPopup();
        window.dispatchEvent(new CustomEvent('fuel-layer:changed', { detail: { enabled: false } }));
    }
}

function scheduleFuelStationsLoad(delay = 260) {
    if (!isFuelLayerEnabled || !map?.getSource(FUEL_STATION_SOURCE_ID)) return;

    window.clearTimeout(fuelStationsLoadTimer);
    fuelStationsLoadTimer = window.setTimeout(loadFuelStationsInView, delay);
}

async function loadFuelStationsInView() {
    if (!isFuelLayerEnabled || !map) return;

    const requestId = ++fuelStationsRequestId;
    fuelStationsAbortController?.abort('superseded');
    fuelStationsAbortController = null;

    if (map.getZoom() < FUEL_STATION_MIN_ZOOM) {
        renderedFuelStationIds = new Set();
        map.getSource(FUEL_STATION_SOURCE_ID)?.setData(buildFuelStationFeatureCollection([]));
        closeFuelStationPopup();
        updateFuelLayerMenuState('zoom');
        return;
    }

    const bounds = map.getBounds();
    const cacheKey = getFuelStationsCacheKey(bounds);
    const cached = fuelStationsCache.get(cacheKey);

    if (cached && Date.now() - cached.savedAt < FUEL_STATION_CACHE_TTL_MS) {
        renderFuelStations(cached.stations);
        updateFuelLayerMenuState(cached.stations.length ? 'ready' : 'empty', cached.stations.length);
        return;
    }

    const requestController = new AbortController();
    const requestTimeout = window.setTimeout(() => requestController.abort('timeout'), 18000);
    fuelStationsAbortController = requestController;
    updateFuelLayerMenuState(renderedFuelStationIds.size ? 'refreshing' : 'loading', renderedFuelStationIds.size);

    try {
        const response = await fetchFuelStations({
            west: bounds.getWest(),
            south: bounds.getSouth(),
            east: bounds.getEast(),
            north: bounds.getNorth(),
        }, {
            signal: requestController.signal,
        });
        if (requestId !== fuelStationsRequestId || !isFuelLayerEnabled) return;

        const stations = normalizeFuelStations(response.data);
        cacheFuelStations(cacheKey, stations);
        renderFuelStations(stations);
        updateFuelLayerMenuState(stations.length ? 'ready' : 'empty', stations.length);
    } catch (error) {
        if (requestId !== fuelStationsRequestId || !isFuelLayerEnabled) return;
        if (error?.name === 'AbortError' && requestController.signal.reason !== 'timeout') return;

        updateFuelLayerMenuState(renderedFuelStationIds.size ? 'stale' : 'error', renderedFuelStationIds.size);
        window.clearTimeout(fuelStationsRetryTimer);
        fuelStationsRetryTimer = window.setTimeout(() => scheduleFuelStationsLoad(0), 10000);
    } finally {
        window.clearTimeout(requestTimeout);
        if (requestId === fuelStationsRequestId) {
            fuelStationsAbortController = null;
        }
    }
}

function getSavedBaseMapLayer() {
    const savedLayer = window.localStorage?.getItem(BASE_LAYER_STORAGE_KEY);

    return BASE_LAYER_IDS.includes(savedLayer) ? savedLayer : DEFAULT_BASE_LAYER_ID;
}

function setBaseMapLayer(layerId = DEFAULT_BASE_LAYER_ID, { persist = false } = {}) {
    if (!BASE_LAYER_IDS.includes(layerId)) {
        return;
    }

    BASE_LAYER_IDS.forEach((id) => {
        const mapLayerId = `basemap-${id}`;

        if (map?.getLayer(mapLayerId)) {
            try {
                map.setLayoutProperty(mapLayerId, 'visibility', id === layerId ? 'visible' : 'none');
            } catch {}
        }
    });
    updateVectorRoadLayerTheme(layerId);

    document.body.dataset.mapLayer = layerId;
    if (persist) {
        window.localStorage?.setItem(BASE_LAYER_STORAGE_KEY, layerId);
    }

    document.querySelectorAll('[data-map-layer]').forEach((button) => {
        button.classList.toggle('is-active', button.dataset.mapLayer === layerId);
    });
}

function updateVectorRoadLayerTheme(layerId) {
    if (!map) return;

    const isSatellite = layerId === 'satellite';
    const isDark = layerId === 'dark';
    const opacity = isSatellite ? 0 : 1;
    const paint = {
        'vector-background': {
            'background-color': isSatellite ? 'rgba(0, 0, 0, 0)' : (isDark ? '#111827' : '#F4F3ED'),
            'background-opacity': isSatellite ? 0 : 1,
        },
        'water-fill': {
            'fill-color': isDark ? '#0F2A3A' : '#B9E3F2',
            'fill-opacity': isSatellite ? 0 : 1,
        },
        'waterway-line': {
            'line-color': isDark ? '#28556A' : '#9BD6EA',
            'line-opacity': isSatellite ? 0 : 0.9,
        },
        'park-fill': {
            'fill-color': isDark ? '#173525' : '#CBE7BF',
            'fill-opacity': isSatellite ? 0 : 0.96,
        },
        'landuse-fill': {
            'fill-color': isDark ? '#182235' : '#ECEDE7',
            'fill-opacity': isSatellite ? 0 : 0.62,
        },
        'landcover-wood': {
            'fill-color': isDark ? '#173522' : '#BFDDAE',
            'fill-opacity': isSatellite ? 0 : 0.88,
        },
        'landcover-grass': {
            'fill-color': isDark ? '#1D3826' : '#D8ECCB',
            'fill-opacity': isSatellite ? 0 : 0.82,
        },
        'landcover-wetland': {
            'fill-color': isDark ? '#183C36' : '#CBE5CE',
            'fill-opacity': isSatellite ? 0 : 0.68,
        },
        'landuse-green': {
            'fill-color': isDark ? '#1A3A24' : '#CFE8BE',
            'fill-opacity': isSatellite ? 0 : 0.9,
        },
        'landuse-residential': {
            'fill-color': isDark ? '#172132' : '#F0EFEB',
            'fill-opacity': isSatellite ? 0 : 0.7,
        },
        'landuse-civic': {
            'fill-color': isDark ? '#2B2638' : '#E8E3F5',
            'fill-opacity': isSatellite ? 0 : 0.78,
        },
        'boundary-line': {
            'line-color': isDark ? 'rgba(226, 232, 240, 0.18)' : 'rgba(71, 85, 105, 0.26)',
            'line-opacity': isSatellite ? 0 : 1,
        },
        'building-footprint': {
            'fill-color': isDark ? '#273548' : '#D9DDD8',
            'fill-outline-color': isDark ? '#33445A' : '#C7CDC7',
            'fill-opacity': isSatellite ? 0 : (isDark ? 0.7 : 0.78),
        },
        'building-3d': {
            'fill-extrusion-color': isDark ? '#33445A' : '#D2D8D3',
            'fill-extrusion-opacity': isSatellite ? 0 : (isDark ? 0.82 : 0.78),
        },
        'rail-casing': {
            'line-color': isDark ? '#273244' : '#FFFFFF',
            'line-opacity': isSatellite ? 0 : 0.9,
        },
        'rail-line': {
            'line-color': isDark ? '#8290A3' : '#A7ADB3',
            'line-opacity': isSatellite ? 0 : 0.82,
        },
        'road-path': {
            'line-color': isDark ? '#526174' : '#C9CDC5',
            'line-opacity': isSatellite ? 0 : 0.82,
        },
        'road-casing-minor': {
            'line-color': isDark ? '#64748B' : '#B8C1CC',
            'line-opacity': isSatellite ? 0 : ROAD_LEGACY_DETAIL_OPACITY(0.92),
        },
        'road-casing-major': {
            'line-color': isDark ? '#718096' : '#AEB8C5',
            'line-opacity': isSatellite ? 0 : ROAD_LEGACY_DETAIL_OPACITY(0.94),
        },
        'road-minor': {
            'line-color': isDark ? '#2A3546' : '#D4DAE2',
            'line-opacity': isSatellite ? 0 : ROAD_LEGACY_DETAIL_OPACITY(0.96),
        },
        'road-major': {
            'line-color': isDark ? '#354052' : '#C6D0DC',
            'line-opacity': isSatellite ? 0 : ROAD_LEGACY_DETAIL_OPACITY(0.96),
        },
        'road-name': {
            'text-color': isDark ? '#F8FAFC' : '#364152',
            'text-halo-color': isDark ? 'rgba(8, 13, 24, 0.92)' : 'rgba(255, 255, 255, 0.96)',
            'text-opacity': isSatellite ? 0 : 1,
        },
        'place-label': {
            'text-color': isDark ? '#DDE8F7' : '#475569',
            'text-halo-color': isDark ? 'rgba(15, 23, 42, 0.92)' : 'rgba(255, 255, 255, 0.94)',
            'text-opacity': isSatellite ? 0 : 0.96,
        },
        'poi-icons': {
            'icon-opacity': isSatellite ? 0 : 0.92,
            'text-color': isDark ? '#EAF2FF' : '#0F172A',
            'text-halo-color': isDark ? 'rgba(9, 15, 27, 0.92)' : 'rgba(255, 255, 255, 0.94)',
            'text-opacity': isSatellite ? 0 : 0.94,
        },
        'transit-labels': {
            'icon-opacity': isSatellite ? 0 : 0.98,
            'text-color': isDark ? '#7DD3FC' : '#2563EB',
            'text-halo-color': isDark ? 'rgba(8, 15, 28, 0.96)' : 'rgba(255, 255, 255, 0.98)',
            'text-opacity': isSatellite ? 0 : 1,
        },
        'house-number': {
            'text-color': isDark ? '#DDE8F7' : '#334155',
            'text-halo-color': isDark ? 'rgba(9, 15, 27, 0.92)' : 'rgba(255, 255, 255, 0.90)',
            'text-opacity': isSatellite ? 0 : 0.82,
        },
    };

    Object.entries(paint).forEach(([layerIdToUpdate, properties]) => {
        if (!map.getLayer(layerIdToUpdate)) return;

        Object.entries(properties).forEach(([property, value]) => {
            try {
                map.setPaintProperty(layerIdToUpdate, property, value);
            } catch {}
        });
    });
}

function addPoiIconImages() {
    const icons = {
        [POI_ICON_IMAGE_IDS.metro]: ['M', '#3B82F6', '#FFFFFF'],
        [POI_ICON_IMAGE_IDS.landmark]: ['L', '#A78BFA', '#FFFFFF'],
        [POI_ICON_IMAGE_IDS.hospital]: ['H', '#EF4444', '#FFFFFF'],
        [POI_ICON_IMAGE_IDS.fuel]: ['F', '#F59E0B', '#1F1300'],
    };

    Object.entries(icons).forEach(([imageId, [label, fill, text]]) => {
        if (map.hasImage(imageId)) return;
        map.addImage(imageId, createPoiIconImage(label, fill, text), { pixelRatio: 2 });
    });
}

function createPoiIconImage(label, fill, textColor) {
    const size = 48;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d');

    context.clearRect(0, 0, size, size);
    context.beginPath();
    context.arc(size / 2, size / 2, 17, 0, Math.PI * 2);
    context.fillStyle = fill;
    context.fill();
    context.lineWidth = 5;
    context.strokeStyle = 'rgba(255, 255, 255, 0.94)';
    context.stroke();
    context.shadowColor = 'rgba(15, 23, 42, 0.35)';
    context.shadowBlur = 8;
    context.fillStyle = textColor;
    context.font = '900 21px Arial, sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(label, size / 2, size / 2 + 1);

    return context.getImageData(0, 0, size, size);
}

function bindTrafficToggle() {
    const button = document.querySelector('[data-traffic-toggle]');

    if (!button) {
        return;
    }

    updateTrafficToggleButton(isTrafficLayerEnabled());
    button.addEventListener('click', () => {
        const isStoredEnabled = isTrafficLayerEnabled();
        const nextValue = isTrafficSuppressedByRoute && isStoredEnabled && !isTrafficForcedVisibleByUser
            ? true
            : !isStoredEnabled;

        if (nextValue !== isStoredEnabled) {
            window.localStorage?.setItem(TRAFFIC_LAYER_STORAGE_KEY, nextValue ? '1' : '0');
        }
        isTrafficForcedVisibleByUser = nextValue;
        setTrafficLayerVisibility(nextValue);
    });
}

function isTrafficLayerEnabled() {
    return window.localStorage?.getItem(TRAFFIC_LAYER_STORAGE_KEY) === '1';
}

function updateTrafficToggleButton(isEnabled) {
    const button = document.querySelector('[data-traffic-toggle]');

    if (!button) return;

    button.classList.toggle('is-active', isEnabled);
    button.classList.toggle('is-loading', false);
    button.setAttribute('aria-pressed', String(isEnabled));
    button.setAttribute('aria-label', isEnabled ? 'Выключить пробки' : 'Включить пробки');
}

function setTrafficLayerVisibility(isVisible) {
    if (!map?.getLayer(TRAFFIC_FLOW_LAYER_ID)) {
        return;
    }

    try {
        map.setLayoutProperty(TRAFFIC_FLOW_LAYER_ID, 'visibility', isVisible ? 'visible' : 'none');
    } catch {
        return;
    }
    updateTrafficToggleButton(isVisible);
}

function bindMapControlButtons() {
    document.querySelectorAll('[data-map-control]').forEach((button) => {
        button.addEventListener('click', () => {
            const control = button.dataset.mapControl;

            if (control === 'zoom-in') {
                dispatchNavigationZoomChange();
                map?.zoomIn({ duration: 180 });
            }
            if (control === 'zoom-out') {
                dispatchNavigationZoomChange();
                map?.zoomOut({ duration: 180 });
            }
            if (control === 'reset-bearing') map?.easeTo({ bearing: 0, pitch: 0, duration: 260 });
        });
    });
}

function bindMapSettings() {
    const settings = document.querySelector('[data-map-settings]');
    const trigger = settings?.querySelector('[data-map-settings-toggle]');
    const panel = settings?.querySelector('[data-map-settings-panel]');

    if (!settings || !trigger || !panel) {
        return;
    }

    panel.innerHTML = `
        <span class="map-settings__title">GPS курсор</span>
        <div class="map-settings__grid">
            ${USER_LOCATION_ICON_OPTIONS.map((option) => `
                <button class="map-settings__option" type="button" data-user-location-icon="${option.id}">
                    <span class="map-settings__preview">${option.svg()}</span>
                    <small>${option.label}</small>
                </button>
            `).join('')}
        </div>
    `;

    const refreshActiveIcon = () => {
        const selected = getSelectedUserLocationIcon();
        panel.querySelectorAll('[data-user-location-icon]').forEach((button) => {
            button.classList.toggle('is-active', button.dataset.userLocationIcon === selected);
        });
    };

    refreshActiveIcon();

    trigger.addEventListener('click', () => {
        const isOpen = settings.classList.toggle('is-open');
        trigger.setAttribute('aria-expanded', String(isOpen));
    });

    panel.querySelectorAll('[data-user-location-icon]').forEach((button) => {
        button.addEventListener('click', () => {
            const icon = button.dataset.userLocationIcon;

            if (!USER_LOCATION_ICON_OPTIONS.some((option) => option.id === icon)) {
                return;
            }

            window.localStorage?.setItem(USER_LOCATION_ICON_STORAGE_KEY, icon);
            refreshActiveIcon();
            if (renderedUserLocation) {
                renderUserLocationFeature(renderedUserLocation);
            }
            settings.classList.remove('is-open');
            trigger.setAttribute('aria-expanded', 'false');
        });
    });

    document.addEventListener('click', (event) => {
        if (settings.contains(event.target)) {
            return;
        }

        settings.classList.remove('is-open');
        trigger.setAttribute('aria-expanded', 'false');
    });
}

async function addMarkerImages() {
    await Promise.all(Object.entries(MARKER_IMAGES).map(([status, colors]) => (
        addSvgImage(`parking-marker-${status}`, createMarkerSvg(...colors), { width: 40, height: 48 })
    )));
    await Promise.all(USER_LOCATION_ICON_OPTIONS.map((option) => (
        addSvgImage(getUserLocationIconImage(option.id), option.svg(), { width: 56, height: 56 })
    )));
}

function addClusterCountImages() {
    for (let count = 2; count <= 999; count += 1) {
        addClusterCountImage(String(count));
    }

    for (let count = 1; count <= 9; count += 1) {
        addClusterCountImage(`${count}k`);
    }
}

function addClusterCountImage(label) {
    const imageId = `cluster-count-${label}`;

    if (map.hasImage(imageId)) {
        return;
    }

    const canvas = document.createElement('canvas');
    const size = 72;
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d');

    context.clearRect(0, 0, size, size);
    context.font = label.length > 2 ? '900 24px Arial, sans-serif' : '900 28px Arial, sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.lineWidth = 5;
    context.strokeStyle = 'rgba(8, 17, 31, 0.48)';
    context.fillStyle = '#FFFFFF';
    context.strokeText(label, size / 2, size / 2 + 1);
    context.fillText(label, size / 2, size / 2 + 1);

    map.addImage(imageId, context.getImageData(0, 0, size, size), { pixelRatio: 2 });
}

const pendingSvgImages = new Map();

function addSvgImage(name, svg, { width = 40, height = 48 } = {}) {
    if (map.hasImage(name)) {
        return Promise.resolve();
    }

    if (pendingSvgImages.has(name)) {
        return pendingSvgImages.get(name);
    }

    const promise = new Promise((resolve, reject) => {
        const image = new Image(width, height);
        image.onload = () => {
            try {
                if (!map?.hasImage(name)) {
                    map?.addImage(name, image, { pixelRatio: 1 });
                }
                resolve();
            } catch (error) {
                if (map?.hasImage(name) || String(error?.message ?? '').includes('already exists')) {
                    resolve();
                    return;
                }

                reject(error);
            }
        };
        image.onerror = reject;
        image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    });

    pendingSvgImages.set(
        name,
        promise.finally(() => {
            pendingSvgImages.delete(name);
        })
    );

    return pendingSvgImages.get(name);
}

function createMarkerSvg(fill, accent) {
    return `
<svg xmlns="http://www.w3.org/2000/svg" width="40" height="48" viewBox="0 0 40 48">
  <defs>
    <filter id="shadow" x="-40%" y="-30%" width="180%" height="180%">
      <feDropShadow dx="0" dy="7" stdDeviation="4" flood-color="#000814" flood-opacity="0.38"/>
    </filter>
  </defs>
  <path filter="url(#shadow)" fill="${fill}" d="M20 2C10.6 2 3 9.6 3 19c0 12.8 17 27 17 27s17-14.2 17-27C37 9.6 29.4 2 20 2Z"/>
  <path fill="${accent}" opacity="0.94" d="M20 6C12.8 6 7 11.8 7 19c0 8.2 8.2 18.1 13 23.1C24.8 37.1 33 27.2 33 19 33 11.8 27.2 6 20 6Z"/>
  <circle cx="20" cy="19" r="8.2" fill="#08111F" opacity="0.24"/>
  <text x="20" y="24" text-anchor="middle" fill="#08111F" font-family="Inter, Arial, sans-serif" font-size="15" font-weight="900">P</text>
</svg>`;
}

function createUserLocationSvg() {
    return `
<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
  <defs>
    <linearGradient id="geo" x1="14" y1="54" x2="50" y2="9" gradientUnits="userSpaceOnUse">
      <stop stop-color="#8B5CF6"/>
      <stop offset="0.48" stop-color="#21A8FF"/>
      <stop offset="1" stop-color="#75F7AF"/>
    </linearGradient>
    <linearGradient id="geoSide" x1="17" y1="55" x2="48" y2="20" gradientUnits="userSpaceOnUse">
      <stop stop-color="#351A8C"/>
      <stop offset="0.54" stop-color="#0F6FD6"/>
      <stop offset="1" stop-color="#0F766E"/>
    </linearGradient>
    <radialGradient id="geoGlass" cx="45%" cy="34%" r="58%">
      <stop stop-color="#FFFFFF" stop-opacity="0.96"/>
      <stop offset="0.42" stop-color="#DDF7FF" stop-opacity="0.46"/>
      <stop offset="1" stop-color="#061018" stop-opacity="0.12"/>
    </radialGradient>
    <filter id="shadow" x="-40%" y="-40%" width="180%" height="180%">
      <feDropShadow dx="0" dy="10" stdDeviation="5.2" flood-color="#061018" flood-opacity="0.42"/>
    </filter>
  </defs>
  <g filter="url(#shadow)">
    <path fill="url(#geoSide)" opacity="0.94" d="M32 6 53 56 32 45.5 11 56 32 6Z" transform="translate(0 3)"/>
    <path fill="url(#geo)" stroke="#F8FAFC" stroke-width="3" stroke-linejoin="round" d="M32 4 53 54 32 43.5 11 54 32 4Z"/>
    <path fill="rgba(6,16,24,.84)" stroke="rgba(255,255,255,.62)" stroke-width="1.4" d="M32 19 40.5 42 32 37.5 23.5 42 32 19Z"/>
    <path fill="url(#geoGlass)" d="M32 9 46 42 32 35.6 18 42 32 9Z" opacity="0.52"/>
    <ellipse cx="32" cy="32.6" rx="5" ry="4.4" fill="#fff"/>
    <path fill="none" stroke="#FFFFFF" stroke-width="1.6" stroke-linecap="round" opacity="0.62" d="M26 18 32 8 38 18"/>
  </g>
</svg>`;
}

function createRedBullF1Svg() {
    return createFormulaCarSvg({
        bodyColor: '#08111F',
        sideColor: '#123B8C',
        accentColor: '#F97316',
        noseColor: '#FACC15',
        wingColor: '#050A14',
        haloColor: '#1E293B',
        label: '1',
    });
}

function createFerrariF1Svg() {
    return createFormulaCarSvg({
        bodyColor: '#DC1628',
        sideColor: '#7F0C17',
        accentColor: '#FFFFFF',
        noseColor: '#F59E0B',
        wingColor: '#080B12',
        haloColor: '#1F2937',
        label: '44',
    });
}

function createFormulaCarSvg({ bodyColor, sideColor, accentColor, noseColor, wingColor, haloColor, label }) {
    return `
<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">
  <defs>
    <linearGradient id="f1-body-${label}" x1="27" y1="86" x2="69" y2="8" gradientUnits="userSpaceOnUse">
      <stop stop-color="${sideColor}"/>
      <stop offset=".38" stop-color="${bodyColor}"/>
      <stop offset=".72" stop-color="${bodyColor}"/>
      <stop offset="1" stop-color="${accentColor}"/>
    </linearGradient>
    <linearGradient id="f1-nose-${label}" x1="42" y1="9" x2="54" y2="77" gradientUnits="userSpaceOnUse">
      <stop stop-color="${noseColor}"/>
      <stop offset=".5" stop-color="${bodyColor}"/>
      <stop offset="1" stop-color="${sideColor}"/>
    </linearGradient>
    <radialGradient id="f1-tyre-${label}" cx="50%" cy="42%" r="62%">
      <stop stop-color="#334155"/>
      <stop offset=".38" stop-color="#05070B"/>
      <stop offset=".74" stop-color="#020308"/>
      <stop offset="1" stop-color="#111827"/>
    </radialGradient>
    <linearGradient id="f1-shine-${label}" x1="35" y1="12" x2="58" y2="70" gradientUnits="userSpaceOnUse">
      <stop stop-color="#FFFFFF" stop-opacity=".78"/>
      <stop offset=".28" stop-color="#FFFFFF" stop-opacity=".20"/>
      <stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/>
    </linearGradient>
    <filter id="f1-shadow-${label}" x="-35%" y="-35%" width="170%" height="175%">
      <feDropShadow dx="0" dy="9" stdDeviation="5" flood-color="#020617" flood-opacity="0.48"/>
    </filter>
    <filter id="f1-glow-${label}" x="-35%" y="-35%" width="170%" height="170%">
      <feDropShadow dx="0" dy="0" stdDeviation="1.2" flood-color="#FFFFFF" flood-opacity="0.35"/>
    </filter>
  </defs>
  <g filter="url(#f1-shadow-${label})">
    <ellipse cx="22" cy="28" rx="9" ry="14" fill="url(#f1-tyre-${label})" transform="rotate(-5 22 28)"/>
    <ellipse cx="74" cy="28" rx="9" ry="14" fill="url(#f1-tyre-${label})" transform="rotate(5 74 28)"/>
    <ellipse cx="19" cy="66" rx="10" ry="15" fill="url(#f1-tyre-${label})" transform="rotate(-6 19 66)"/>
    <ellipse cx="77" cy="66" rx="10" ry="15" fill="url(#f1-tyre-${label})" transform="rotate(6 77 66)"/>
    <path fill="#111827" opacity=".95" d="M16 16h64l7 8-7 8H16l-7-8 7-8ZM12 75h72l7 8-7 7H12l-7-7 7-8Z"/>
    <path fill="${wingColor}" stroke="#CBD5E1" stroke-width="1.2" d="M18 18h60l4 5-4 5H18l-4-5 4-5ZM14 77h68l4 5-4 5H14l-4-5 4-5Z"/>
    <path fill="#0B1020" d="M27 29h12l4 8-6 9H25l-6-10 8-7ZM57 29h12l8 7-6 10H59l-6-9 4-8ZM27 58h12l4 10-7 11H23l-6-12 10-9ZM57 58h12l10 9-6 12H60l-7-11 4-10Z"/>
    <path fill="#1F2937" opacity=".96" d="M27 31h9l3 6-4 6h-8l-4-7 4-5ZM60 31h9l4 5-4 7h-8l-4-6 3-6ZM27 61h9l3 7-5 8h-8l-5-8 6-7ZM60 61h9l6 7-5 8h-8l-5-8 3-7Z"/>
    <path fill="${wingColor}" d="M31 31h34v6H31zM28 67h40v7H28z"/>
    <path fill="url(#f1-body-${label})" stroke="#F8FAFC" stroke-width="2.2" d="M48 7c8 9 12 23 12 42 0 20-4 34-12 41-8-7-12-21-12-41 0-19 4-33 12-42Z"/>
    <path fill="url(#f1-nose-${label})" d="M48 12c4 9 6 22 6 38 0 15-2 26-6 32-4-6-6-17-6-32 0-16 2-29 6-38Z"/>
    <path fill="${accentColor}" opacity=".88" d="M42 19c-4 8-6 17-6 28h5c0-11 2-20 5-27l2-5-6 4ZM54 19c4 8 6 17 6 28h-5c0-11-2-20-5-27l-2-5 6 4Z"/>
    <path fill="${haloColor}" stroke="#F8FAFC" stroke-width="1.4" d="M48 36c7 0 12 6 12 14 0 7-5 13-12 13S36 57 36 50c0-8 5-14 12-14Zm0 6c-4 0-6 3-6 8 0 4 2 7 6 7s6-3 6-7c0-5-2-8-6-8Z"/>
    <ellipse cx="48" cy="50" rx="5.5" ry="8" fill="#030712"/>
    <path fill="url(#f1-shine-${label})" d="M45 13c-3 12-4 23-4 36 0 15 2 24 5 30-1-18 0-42 4-64l-5-2Z"/>
    <path fill="none" stroke="#F8FAFC" stroke-width="1.5" stroke-linecap="round" opacity=".72" d="M34 42l-12-8M62 42l12-8M35 64l-17 12M61 64l17 12M39 81h18"/>
    <text x="48" y="31" text-anchor="middle" fill="#fff" stroke="#020617" stroke-width="2" paint-order="stroke" font-family="Inter, Arial, sans-serif" font-size="11" font-weight="950">${label}</text>
  </g>
</svg>`;
}

function createPlaneSvg() {
    return `
<svg xmlns="http://www.w3.org/2000/svg" width="52" height="52" viewBox="0 0 52 52">
  <defs><linearGradient id="plane" x1="10" y1="46" x2="42" y2="6"><stop stop-color="#0EA5E9"/><stop offset=".48" stop-color="#E0F2FE"/><stop offset="1" stop-color="#FFFFFF"/></linearGradient><filter id="shadow" x="-35%" y="-35%" width="170%" height="170%"><feDropShadow dx="0" dy="7" stdDeviation="4" flood-color="#061018" flood-opacity="0.34"/></filter></defs>
  <g filter="url(#shadow)">
    <path fill="url(#plane)" stroke="#fff" stroke-width="2" d="M26 3c3 5 5 12 5 21l17 12c1 1 1 4-1 5l-16-5-1 8 5 4-2 3-7-3-7 3-2-3 5-4-1-8-16 5c-2-1-2-4-1-5l17-12c0-9 2-16 5-21Z"/>
    <path fill="#0F172A" opacity=".72" d="M26 12c2 4 3 8 3 13l-3 3-3-3c0-5 1-9 3-13Z"/>
    <path fill="#38BDF8" d="M23 35h6l-1 7h-4l-1-7Z"/>
  </g>
</svg>`;
}

function createHelicopterSvg() {
    return `
<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">
  <defs>
    <linearGradient id="heli-body" x1="22" y1="82" x2="68" y2="18" gradientUnits="userSpaceOnUse">
      <stop stop-color="#172A22"/>
      <stop offset=".42" stop-color="#315344"/>
      <stop offset=".72" stop-color="#4B6355"/>
      <stop offset="1" stop-color="#A3B2A7"/>
    </linearGradient>
    <linearGradient id="heli-glass" x1="31" y1="33" x2="55" y2="59" gradientUnits="userSpaceOnUse">
      <stop stop-color="#D8F3FF"/>
      <stop offset=".38" stop-color="#68B5C7"/>
      <stop offset="1" stop-color="#0F172A"/>
    </linearGradient>
    <filter id="heli-shadow" x="-35%" y="-35%" width="170%" height="170%">
      <feDropShadow dx="0" dy="9" stdDeviation="5" flood-color="#020617" flood-opacity=".44"/>
    </filter>
    <filter id="rotor-blur" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation=".55"/>
    </filter>
  </defs>
  <g filter="url(#heli-shadow)">
    <g filter="url(#rotor-blur)" opacity=".82">
      <path stroke="#DCE7E1" stroke-width="4" stroke-linecap="round" d="M13 13 83 83M83 13 13 83"/>
      <path stroke="#94A3B8" stroke-width="2" stroke-linecap="round" d="M17 18 79 78M79 18 17 78"/>
    </g>
    <path stroke="#121A17" stroke-width="7" stroke-linecap="round" d="M48 48 80 54"/>
    <path stroke="#8AA099" stroke-width="3" stroke-linecap="round" d="M79 45v18M70 49l10 5-11 5"/>
    <path fill="#1F352C" d="M22 53 8 61v7l18-3 8-6-12-6ZM74 53l14 8v7l-18-3-8-6 12-6Z"/>
    <path fill="url(#heli-body)" stroke="#E6F0EA" stroke-width="2.2" d="M48 18c13 5 21 18 21 35 0 17-9 29-21 34-12-5-21-17-21-34 0-17 8-30 21-35Z"/>
    <path fill="#203B31" opacity=".95" d="M35 49c0-12 5-22 13-27 8 5 13 15 13 27 0 10-5 18-13 22-8-4-13-12-13-22Z"/>
    <path fill="url(#heli-glass)" stroke="#D9E7E2" stroke-width="1.4" d="M38 38c2-8 6-13 10-16 4 3 8 8 10 16-3 4-7 6-10 6s-7-2-10-6Z"/>
    <path fill="#111827" opacity=".86" d="M39 47h18c2 0 4 2 4 5s-2 5-4 5H39c-2 0-4-2-4-5s2-5 4-5Z"/>
    <path fill="#6B7F71" d="M32 62h32l-5 13H37l-5-13Z"/>
    <path fill="#0F1F19" d="M38 73h20l-3 7H41l-3-7Z"/>
    <path stroke="#DCE7E1" stroke-width="3" stroke-linecap="round" d="M28 82h40M34 76v10M62 76v10"/>
    <path stroke="#101A16" stroke-width="3" stroke-linecap="round" d="M20 58h15M61 58h15"/>
    <circle cx="28" cy="58" r="4" fill="#111827" stroke="#DCE7E1" stroke-width="1.3"/>
    <circle cx="68" cy="58" r="4" fill="#111827" stroke="#DCE7E1" stroke-width="1.3"/>
    <circle cx="48" cy="48" r="5" fill="#E5E7EB" stroke="#111827" stroke-width="1.4"/>
    <path fill="none" stroke="#F8FAFC" stroke-width="1.4" stroke-linecap="round" opacity=".55" d="M42 25c-5 8-7 17-7 27M53 23c6 8 8 18 8 29"/>
  </g>
</svg>`;
}

function createBuranSvg() {
    return `
<svg xmlns="http://www.w3.org/2000/svg" width="54" height="54" viewBox="0 0 54 54">
  <defs><linearGradient id="buran" x1="11" y1="45" x2="43" y2="7"><stop stop-color="#94A3B8"/><stop offset=".45" stop-color="#F8FAFC"/><stop offset="1" stop-color="#FFFFFF"/></linearGradient><filter id="shadow" x="-35%" y="-35%" width="170%" height="170%"><feDropShadow dx="0" dy="7" stdDeviation="4" flood-color="#061018" flood-opacity="0.34"/></filter></defs>
  <g filter="url(#shadow)">
    <path fill="url(#buran)" stroke="#fff" stroke-width="2" d="M27 3c5 6 8 14 8 25l15 16-14-4-5 10h-8l-5-10-14 4 15-16c0-11 3-19 8-25Z"/>
    <path fill="#111827" opacity=".82" d="M27 12c3 4 4 9 4 16l-4 4-4-4c0-7 1-12 4-16Z"/>
    <path fill="#CBD5E1" d="M19 28h16l-3 13H22l-3-13Z"/>
    <path fill="#EF4444" d="M22 43h10l-2 5h-6l-2-5Z"/>
    <path stroke="#2563EB" stroke-width="1.5" stroke-linecap="round" d="M19 35h16"/>
  </g>
</svg>`;
}

function getSelectedUserLocationIcon() {
    const saved = window.localStorage?.getItem(USER_LOCATION_ICON_STORAGE_KEY);

    return USER_LOCATION_ICON_OPTIONS.some((option) => option.id === saved) ? saved : 'auralith';
}

function getUserLocationIconImage(icon = getSelectedUserLocationIcon()) {
    return `${USER_LOCATION_ICON_PREFIX}${icon}`;
}

function bindPerformanceMode() {
    let timer = null;
    const start = () => {
        document.body.classList.add('is-map-interacting');
        setTrafficInteractionMode(true);
        window.clearTimeout(timer);
    };
    const stop = () => {
        window.clearTimeout(timer);
        timer = window.setTimeout(() => {
            document.body.classList.remove('is-map-interacting');
            setTrafficInteractionMode(false);
        }, 180);
    };

    const detachNavigationOnManualInteraction = (event) => {
        if (isManualMapInteraction(event, document.body.classList.contains('is-navigation-following'))) {
            window.dispatchEvent(new CustomEvent('navigation:manual-map-move'));
        }
    };
    const dispatchManualMapInteraction = (event) => {
        if (event?.originalEvent) {
            window.dispatchEvent(new CustomEvent('map:manual-interaction'));
        }
    };
    const dispatchRawManualMapInteraction = () => {
        window.dispatchEvent(new CustomEvent('map:manual-interaction'));
    };

    map.getCanvas()?.addEventListener('wheel', dispatchRawManualMapInteraction, { passive: true });
    map.getCanvas()?.addEventListener('touchstart', dispatchRawManualMapInteraction, { passive: true });
    map.getCanvas()?.addEventListener('pointerdown', dispatchRawManualMapInteraction, { passive: true });

    map.on('movestart', (event) => {
        start();
        dispatchManualMapInteraction(event);
        detachNavigationOnManualInteraction(event);
    });
    map.on('zoomstart', (event) => {
        start();
        dispatchManualMapInteraction(event);
        if (event.originalEvent) {
            detachNavigationOnManualInteraction(event);
            dispatchNavigationZoomChange();
        }
    });
    map.on('moveend', stop);
    map.on('zoomend', stop);
    map.on('click', stop);
    map.on('dragstart', (event) => {
        dispatchManualMapInteraction(event);
        detachNavigationOnManualInteraction(event);
    });
    map.on('rotatestart', (event) => {
        dispatchManualMapInteraction(event);
        detachNavigationOnManualInteraction(event);
    });
    map.on('pitchstart', (event) => {
        dispatchManualMapInteraction(event);
        detachNavigationOnManualInteraction(event);
    });
}

function dispatchNavigationZoomChange() {
    if (document.body.classList.contains('is-navigation-following')) {
        window.dispatchEvent(new CustomEvent('navigation:manual-map-zoom'));
    }
}

function setTrafficInteractionMode(isInteracting) {
    if (!map?.getLayer(TRAFFIC_FLOW_LAYER_ID) || !window.matchMedia('(max-width: 720px)').matches) {
        return;
    }

    try {
        map.setPaintProperty(TRAFFIC_FLOW_LAYER_ID, 'raster-opacity', isInteracting ? 0.28 : 0.70);
    } catch {}
}

function addParkingSource() {
    map.addSource(SOURCE_ID, {
        type: 'geojson',
        data: buildFeatureCollection([]),
        cluster: true,
        clusterMaxZoom: 15,
        clusterRadius: 58,
    });
}

function addParkingLayers() {
    map.addLayer({
        id: 'clusters',
        type: 'circle',
        source: SOURCE_ID,
        filter: ['has', 'point_count'],
        paint: {
            'circle-color': '#4A9EFF',
            'circle-radius': ['step', ['get', 'point_count'], 19, 10, 23, 35, 28],
            'circle-stroke-width': 4,
            'circle-stroke-color': 'rgba(248, 250, 252, 0.92)',
            'circle-opacity': 0.94,
            'circle-stroke-opacity': 0.9,
        },
    });

    map.addLayer({
        id: 'spots-pin',
        type: 'symbol',
        source: SOURCE_ID,
        filter: ['!', ['has', 'point_count']],
        layout: {
            'icon-image': ['concat', 'parking-marker-', ['get', 'status']],
            'icon-anchor': 'bottom',
            'icon-size': ['interpolate', ['linear'], ['zoom'], 12, 0.74, 16, 0.92, 18, 1.04],
            'icon-rotate': ['coalesce', ['to-number', ['get', 'heading']], 0],
            'icon-pitch-alignment': 'viewport',
            'icon-rotation-alignment': 'viewport',
            'icon-allow-overlap': true,
            'icon-ignore-placement': true,
        },
    });

    map.addLayer({
        id: 'cluster-count',
        type: 'symbol',
        source: SOURCE_ID,
        filter: ['has', 'point_count'],
        layout: {
            'text-field': ['get', 'point_count_abbreviated'],
            'text-font': ['Noto Sans Bold'],
            'text-size': ['step', ['get', 'point_count'], 15, 10, 16, 35, 18],
            'text-allow-overlap': true,
            'text-ignore-placement': true,
            'text-pitch-alignment': 'viewport',
            'text-rotation-alignment': 'viewport',
        },
        paint: {
            'text-color': '#FFFFFF',
            'text-halo-color': 'rgba(8, 17, 31, 0.34)',
            'text-halo-width': 1.6,
        },
    });
}

function addPendingSourceAndLayer() {
    map.addSource(PENDING_SOURCE_ID, {
        type: 'geojson',
        data: buildFeatureCollection([]),
    });

    map.addLayer({
        id: 'pending-spot',
        type: 'symbol',
        source: PENDING_SOURCE_ID,
        layout: {
            'icon-image': 'parking-marker-new',
            'icon-anchor': 'bottom',
            'icon-size': ['interpolate', ['linear'], ['zoom'], 12, 0.76, 16, 0.94, 18, 1.04],
            'icon-pitch-alignment': 'viewport',
            'icon-rotation-alignment': 'viewport',
            'icon-allow-overlap': true,
            'icon-ignore-placement': true,
        },
    });
}

function addPersonalPlacesSourceAndLayer() {
    map.addSource(PERSONAL_PLACE_SOURCE_ID, {
        type: 'geojson',
        data: buildFeatureCollection([]),
    });

    map.addLayer({
        id: 'personal-place-halo',
        type: 'circle',
        source: PERSONAL_PLACE_SOURCE_ID,
        paint: {
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 8, 16, 13],
            'circle-color': 'rgba(124, 61, 255, 0.20)',
            'circle-stroke-color': 'rgba(103, 232, 249, 0.88)',
            'circle-stroke-width': 2,
        },
    });

    map.addLayer({
        id: 'personal-place-dot',
        type: 'circle',
        source: PERSONAL_PLACE_SOURCE_ID,
        paint: {
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 4, 16, 6],
            'circle-color': '#21A8FF',
            'circle-stroke-color': '#FFFFFF',
            'circle-stroke-width': 1.5,
        },
    });

    map.addLayer({
        id: 'personal-place-label',
        type: 'symbol',
        source: PERSONAL_PLACE_SOURCE_ID,
        minzoom: 13,
        layout: {
            'text-field': ['get', 'title'],
            'text-font': ['Noto Sans Bold'],
            'text-size': 11,
            'text-offset': [0, 1.4],
            'text-anchor': 'top',
            'text-allow-overlap': false,
        },
        paint: {
            'text-color': '#EAF7FF',
            'text-halo-color': 'rgba(5, 15, 35, 0.82)',
            'text-halo-width': 1.5,
        },
    });
}

function addUserLocationSourceAndLayer() {
    map.addSource(USER_LOCATION_SOURCE_ID, {
        type: 'geojson',
        data: {
            type: 'FeatureCollection',
            features: [],
        },
    });

    map.addLayer({
        id: 'user-location-accuracy',
        type: 'circle',
        source: USER_LOCATION_SOURCE_ID,
        paint: {
            'circle-radius': [
                'interpolate',
                ['linear'],
                ['zoom'],
                10,
                ['/', ['coalesce', ['to-number', ['get', 'accuracy']], 20], 18],
                16,
                ['/', ['coalesce', ['to-number', ['get', 'accuracy']], 20], 2.8],
            ],
            'circle-color': 'rgba(33, 168, 255, 0.16)',
            'circle-stroke-color': 'rgba(33, 168, 255, 0.34)',
            'circle-stroke-width': 1,
        },
    });

    map.addLayer({
        id: 'user-location-dot',
        type: 'symbol',
        source: USER_LOCATION_SOURCE_ID,
        filter: ['!=', ['get', 'mode'], 'navigation'],
        layout: {
            'icon-image': ['get', 'iconImage'],
            'icon-size': ['interpolate', ['linear'], ['zoom'], 12, 0.58, 16, 0.74, 18, 0.86],
            'icon-rotate': ['coalesce', ['to-number', ['get', 'heading']], 0],
            'icon-pitch-alignment': 'viewport',
            'icon-rotation-alignment': 'viewport',
            'icon-allow-overlap': true,
            'icon-ignore-placement': true,
        },
    });

    map.addLayer({
        id: 'user-navigation-dot',
        type: 'symbol',
        source: USER_LOCATION_SOURCE_ID,
        filter: ['==', ['get', 'mode'], 'navigation'],
        layout: {
            'icon-image': ['get', 'iconImage'],
            'icon-size': ['interpolate', ['linear'], ['zoom'], 12, 0.56, 16, 0.72, 18, 0.84],
            'icon-rotate': ['coalesce', ['to-number', ['get', 'heading']], 0],
            'icon-pitch-alignment': 'viewport',
            'icon-rotation-alignment': 'map',
            'icon-allow-overlap': true,
            'icon-ignore-placement': true,
        },
    });
}

function addRouteSourceAndLayer() {
    map.addSource(ROUTE_SOURCE_ID, {
        type: 'geojson',
        data: buildFeatureCollection([]),
    });

    map.addLayer({
        id: ROUTE_CASING_LAYER_ID,
        type: 'line',
        source: ROUTE_SOURCE_ID,
        layout: {
            'line-cap': 'round',
            'line-join': 'round',
        },
        paint: {
            'line-color': 'rgba(3, 9, 24, 0.94)',
            'line-width': ['interpolate', ['linear'], ['zoom'], 11, 12, 16, 21],
            'line-blur': ['interpolate', ['linear'], ['zoom'], 11, 0.6, 16, 1.2],
            'line-opacity': 0.84,
        },
    }, 'spots-pin');

    map.addLayer({
        id: ROUTE_GLOW_LAYER_ID,
        type: 'line',
        source: ROUTE_SOURCE_ID,
        layout: {
            'line-cap': 'round',
            'line-join': 'round',
        },
        paint: {
            'line-color': '#55C7FF',
            'line-width': ['interpolate', ['linear'], ['zoom'], 11, 9, 16, 17],
            'line-blur': ['interpolate', ['linear'], ['zoom'], 11, 2.2, 16, 4.2],
            'line-opacity': 0.38,
        },
    }, 'spots-pin');

    map.addLayer({
        id: ROUTE_LINE_LAYER_ID,
        type: 'line',
        source: ROUTE_SOURCE_ID,
        layout: {
            'line-cap': 'round',
            'line-join': 'round',
        },
        paint: {
            'line-color': '#635BFF',
            'line-width': ['interpolate', ['linear'], ['zoom'], 11, 6.5, 16, 12.5],
            'line-opacity': 0.98,
        },
    }, 'spots-pin');

    map.addLayer({
        id: ROUTE_HIGHLIGHT_LAYER_ID,
        type: 'line',
        source: ROUTE_SOURCE_ID,
        layout: {
            'line-cap': 'round',
            'line-join': 'round',
        },
        paint: {
            'line-color': 'rgba(255, 255, 255, 0.9)',
            'line-width': ['interpolate', ['linear'], ['zoom'], 11, 1, 16, 2],
            'line-blur': 0.2,
            'line-opacity': 0.34,
        },
    }, 'spots-pin');
}

function addTrafficFlowLayer() {
    const apiKey = getTomTomTrafficKey();

    if (!apiKey || map.getSource(TRAFFIC_FLOW_SOURCE_ID)) {
        return;
    }

    map.addSource(TRAFFIC_FLOW_SOURCE_ID, {
        type: 'raster',
        tiles: [
            `https://api.tomtom.com/traffic/map/4/tile/flow/relative/{z}/{x}/{y}.png?key=${encodeURIComponent(apiKey)}&tileSize=256&thickness=6`,
        ],
        tileSize: 256,
        minzoom: 5,
        maxzoom: 19,
        attribution: 'Traffic © TomTom',
    });

    map.addLayer({
        id: TRAFFIC_FLOW_LAYER_ID,
        type: 'raster',
        source: TRAFFIC_FLOW_SOURCE_ID,
        layout: {
            visibility: isTrafficLayerEnabled() ? 'visible' : 'none',
        },
        paint: {
            'raster-opacity': 0.70,
            'raster-fade-duration': 0,
        },
    }, ROUTE_CASING_LAYER_ID);

    updateTrafficToggleButton(isTrafficLayerEnabled());
    keepNavigationLayersOrdered();
}

function getTomTomTrafficKey() {
    return document.querySelector('.map-screen')?.dataset.tomtomTrafficKey?.trim() || '';
}

function bindMapEvents() {
    window.addEventListener('fuel-station:route-opened', closeFuelStationPopup);

    map.on('click', 'clusters', async (event) => {
        await expandCluster(event);
    });
    map.on('click', 'cluster-count', async (event) => {
        await expandCluster(event);
    });
    map.on('click', 'fuel-station-cluster', async (event) => {
        closeFuelStationPopup();
        await expandFuelStationCluster(event);
    });
    map.on('click', 'fuel-station-cluster-count', async (event) => {
        closeFuelStationPopup();
        await expandFuelStationCluster(event);
    });

    map.on('click', 'spots-pin', (event) => selectSpotFromFeature(event.features?.[0]));
    map.on('click', 'fuel-station-pin', (event) => showFuelStationPopup(event.features?.[0]));
    map.on('click', 'personal-place-dot', (event) => selectPersonalPlaceFromFeature(event.features?.[0]));

    map.on('mouseenter', 'clusters', () => setMapCursor('pointer'));
    map.on('mouseleave', 'clusters', () => setMapCursor(''));
    map.on('mouseenter', 'cluster-count', () => setMapCursor('pointer'));
    map.on('mouseleave', 'cluster-count', () => setMapCursor(''));
    map.on('mouseenter', 'spots-pin', () => setMapCursor('pointer'));
    map.on('mouseleave', 'spots-pin', () => setMapCursor(''));
    map.on('mouseenter', 'fuel-station-pin', () => setMapCursor('pointer'));
    map.on('mouseleave', 'fuel-station-pin', () => setMapCursor(''));
    map.on('mouseenter', 'fuel-station-cluster', () => setMapCursor('pointer'));
    map.on('mouseleave', 'fuel-station-cluster', () => setMapCursor(''));
    map.on('mouseenter', 'fuel-station-cluster-count', () => setMapCursor('pointer'));
    map.on('mouseleave', 'fuel-station-cluster-count', () => setMapCursor(''));
    map.on('mouseenter', 'personal-place-dot', () => setMapCursor('pointer'));
    map.on('mouseleave', 'personal-place-dot', () => setMapCursor(''));

    map.on('click', (event) => {
        if (clickedFeature(event.point)) {
            return;
        }

        if (isRouteDestinationPickingMode) {
            selectRouteDestination(event.lngLat);
            return;
        }

        if (!isPickingMode) {
            return;
        }

        const coords = [event.lngLat.lat, event.lngLat.lng];
        setPendingCoords(coords);

        window.dispatchEvent(new CustomEvent('map:coords-selected', {
            detail: {
                latitude: coords[0],
                longitude: coords[1],
            },
        }));

        resolveAddress(coords);
    });

    map.on('contextmenu', (event) => {
        if (!isRouteDestinationPickingMode && !document.body.classList.contains('is-navigation-mode')) {
            return;
        }

        if (clickedFeature(event.point)) {
            return;
        }

        event.preventDefault?.();
        selectRouteDestination(event.lngLat);
    });

    map.on('moveend', () => {
        if (isFuelLayerEnabled) {
            scheduleFuelStationsLoad();
        }
    });
}

async function expandCluster(event) {
    const feature = map.queryRenderedFeatures(event.point, { layers: ['clusters', 'cluster-count'] })[0];
    const clusterId = feature?.properties?.cluster_id;
    const source = map.getSource(SOURCE_ID);

    if (!source || clusterId === undefined) return;

    const zoom = await source.getClusterExpansionZoom(clusterId);
    safeEaseTo({
        center: feature.geometry.coordinates,
        zoom,
        duration: 220,
    });
}

async function expandFuelStationCluster(event) {
    const feature = map.queryRenderedFeatures(event.point, {
        layers: ['fuel-station-cluster', 'fuel-station-cluster-count'],
    })[0];
    const clusterId = feature?.properties?.cluster_id;
    const source = map.getSource(FUEL_STATION_SOURCE_ID);

    if (!source || clusterId === undefined) return;

    const zoom = await source.getClusterExpansionZoom(clusterId);
    safeEaseTo({
        center: feature.geometry.coordinates,
        zoom,
        duration: 220,
    });
}

function clickedFeature(point) {
    return map.queryRenderedFeatures(point, {
        layers: [
            'clusters',
            'cluster-count',
            'spots-pin',
            'fuel-station-cluster',
            'fuel-station-cluster-count',
            'fuel-station-pin',
            'personal-place-dot',
        ],
    }).length > 0;
}

function setMapCursor(cursor) {
    map.getCanvas().style.cursor = cursor;
}

function selectSpotFromFeature(feature) {
    if (!feature?.properties?.spotId) {
        return;
    }

    const spot = spotsCache.find((item) => Number(item.id) === Number(feature.properties.spotId));

    if (spot) {
        window.dispatchEvent(new CustomEvent('parking:selected', { detail: spot }));
    }
}

function showFuelStationPopup(feature) {
    if (!isFuelLayerEnabled || !feature?.geometry?.coordinates) return;

    const properties = feature.properties ?? {};
    let prices = {};
    try {
        prices = JSON.parse(properties.pricesJson || '{}');
    } catch {}

    const priceRows = Object.entries(prices)
        .map(([fuel, price]) => `
            <div class="fuel-popup__price">
                <span>${escapeMapHtml(fuel)}</span>
                <strong>${escapeMapHtml(price)}</strong>
            </div>
        `)
        .join('');
    const updatedAt = formatFuelUpdatedAt(properties.updatedAt);

    closeFuelStationPopup();
    const sourceLink = isSafeHttpUrl(properties.osmUrl)
        ? `<a href="${escapeMapAttribute(properties.osmUrl)}" target="_blank" rel="noreferrer">Открыть источник</a>`
        : '';
    fuelStationPopup = new maplibregl.Popup({
        closeButton: true,
        closeOnClick: true,
        offset: 30,
        className: 'fuel-station-popup',
        maxWidth: '330px',
    })
        .setLngLat(feature.geometry.coordinates)
        .setHTML(`
            <article class="fuel-popup">
                <div class="fuel-popup__head">
                    <span class="fuel-popup__status is-unknown">${escapeMapHtml(properties.name || properties.brand || 'АЗС')}</span>
                    <p>${escapeMapHtml(properties.address || properties.brand || 'Адрес не указан')}</p>
                </div>
                <div class="fuel-popup__prices">
                    ${priceRows || '<p class="fuel-popup__notice">Цена не опубликована в открытых данных.</p>'}
                </div>
                ${properties.openingHours ? `<p class="fuel-popup__hours">Режим: ${escapeMapHtml(properties.openingHours)}</p>` : ''}
                ${updatedAt ? `<small>Данные обновлены: ${escapeMapHtml(updatedAt)}</small>` : ''}
                ${properties.priceSource ? `<small>Источник цены: ${escapeMapHtml(properties.priceSource)}</small>` : ''}
                <button
                    class="route-button fuel-popup__route"
                    type="button"
                    data-action="route-fuel-station"
                    data-fuel-route
                    data-station-id="${escapeMapAttribute(properties.stationId || '')}"
                    data-title="${escapeMapAttribute(properties.name || properties.brand || 'АЗС')}"
                    data-address="${escapeMapAttribute(properties.address || '')}"
                    data-latitude="${escapeMapAttribute(feature.geometry.coordinates[1])}"
                    data-longitude="${escapeMapAttribute(feature.geometry.coordinates[0])}"
                >Маршрут</button>
                ${sourceLink}
            </article>
        `)
        .addTo(map);

    fuelStationPopup.on('close', () => {
        fuelStationPopup = null;
    });
}

function selectPersonalPlaceFromFeature(feature) {
    const properties = feature?.properties ?? {};
    const latitude = Number(properties.latitude);
    const longitude = Number(properties.longitude);

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        return;
    }

    window.dispatchEvent(new CustomEvent('navigator:personal-place-selected', {
        detail: {
            id: properties.placeId,
            title: properties.title,
            address: properties.address,
            latitude,
            longitude,
        },
    }));
}

export function addParkingSpotToMap(spot) {
    const exists = spotsCache.some((item) => Number(item.id) === Number(spot.id));
    spotsCache = exists
        ? spotsCache.map((item) => (Number(item.id) === Number(spot.id) ? spot : item))
        : [spot, ...spotsCache];

    renderParkingSpots(spotsCache);
    focusSpot(spot);
}

export function replaceParkingSpotsOnMap(spots) {
    spotsCache = spots;
    renderParkingSpots(spotsCache);
}

export function replacePersonalPlacesOnMap(places = []) {
    const source = map?.getSource(PERSONAL_PLACE_SOURCE_ID);
    if (!source) return;

    source.setData(buildFeatureCollection((places || [])
        .filter((place) => Number.isFinite(Number(place.latitude)) && Number.isFinite(Number(place.longitude)))
        .map((place) => ({
            type: 'Feature',
            geometry: {
                type: 'Point',
                coordinates: [Number(place.longitude), Number(place.latitude)],
            },
            properties: {
                placeId: String(place.id ?? ''),
                title: String(place.title || 'Моя точка'),
                address: String(place.address || ''),
                latitude: Number(place.latitude),
                longitude: Number(place.longitude),
            },
        }))));
}

export function focusSpot(spot) {
    if (!map || !spot) {
        return;
    }

    safeEaseTo({
        center: [Number(spot.longitude), Number(spot.latitude)],
        zoom: Math.max(map.getZoom(), 15),
        duration: 220,
    });
    window.dispatchEvent(new CustomEvent('parking:selected', { detail: spot }));
}

export function focusSpots(spots) {
    if (!map || !spots?.length) {
        return;
    }

    if (spots.length === 1) {
        focusSpot(spots[0]);
        return;
    }

    const bounds = new maplibregl.LngLatBounds();
    spots.forEach((spot) => bounds.extend([Number(spot.longitude), Number(spot.latitude)]));

    safeFitBounds(bounds, {
        padding: { top: 96, right: 90, bottom: 120, left: 90 },
        duration: 220,
        maxZoom: 15,
    });
}

export function focusUserLocation({ latitude, longitude, accuracy = 0, heading = 0, headingMode = 'compass' }, { focus = true } = {}) {
    if (!map) {
        return;
    }

    const nextLocation = {
        latitude: Number(latitude),
        longitude: Number(longitude),
        accuracy: Math.max(Number(accuracy) || 0, 20),
        heading: Number.isFinite(Number(heading)) ? Number(heading) : 0,
        headingMode: headingMode === 'navigation' ? 'navigation' : 'compass',
        updatedAt: performance.now(),
    };

    if (!Number.isFinite(nextLocation.latitude) || !Number.isFinite(nextLocation.longitude)) {
        return;
    }

    if (nextLocation.headingMode === 'navigation') {
        if (userLocationRenderFrame) {
            window.cancelAnimationFrame(userLocationRenderFrame);
            userLocationRenderFrame = null;
        }
        renderedUserLocation = { ...nextLocation };
        targetUserLocation = { ...nextLocation };
        renderUserLocationFeature(renderedUserLocation);
    } else if (!renderedUserLocation || renderedUserLocation.headingMode !== nextLocation.headingMode) {
        renderedUserLocation = { ...nextLocation };
        targetUserLocation = { ...nextLocation };
        renderUserLocationFeature(renderedUserLocation);
    } else {
        targetUserLocation = { ...nextLocation };
        startUserLocationAnimation();
    }

    if (focus) {
        safeEaseTo({
            center: [nextLocation.longitude, nextLocation.latitude],
            zoom: Math.min(Math.max(map.getZoom(), 13.8), 14.8),
            duration: 260,
        });
    }
}

export function getMapCenterLocation() {
    if (!map) {
        return null;
    }

    const center = map.getCenter();

    return {
        latitude: center.lat,
        longitude: center.lng,
        accuracy: null,
        updatedAt: Date.now(),
    };
}

function renderUserLocationFeature(location) {
    map.getSource(USER_LOCATION_SOURCE_ID)?.setData({
        type: 'FeatureCollection',
        features: [{
            type: 'Feature',
            properties: {
                accuracy: location.accuracy,
                heading: location.heading,
                mode: location.headingMode,
                iconImage: getUserLocationIconImage(),
            },
            geometry: {
                type: 'Point',
                coordinates: [location.longitude, location.latitude],
            },
        }],
    });
}

function startUserLocationAnimation() {
    if (userLocationRenderFrame) return;

    const step = () => {
        if (!renderedUserLocation || !targetUserLocation) {
            userLocationRenderFrame = null;
            return;
        }

        const factor = 0.22;
        renderedUserLocation.latitude += (targetUserLocation.latitude - renderedUserLocation.latitude) * factor;
        renderedUserLocation.longitude += (targetUserLocation.longitude - renderedUserLocation.longitude) * factor;
        renderedUserLocation.accuracy += (targetUserLocation.accuracy - renderedUserLocation.accuracy) * factor;
        renderedUserLocation.headingMode = targetUserLocation.headingMode;
        renderedUserLocation.heading = renderedUserLocation.headingMode === 'navigation'
            ? targetUserLocation.heading
            : interpolateBearing(renderedUserLocation.heading, targetUserLocation.heading, factor);

        renderUserLocationFeature(renderedUserLocation);

        const distance = Math.hypot(
            targetUserLocation.latitude - renderedUserLocation.latitude,
            targetUserLocation.longitude - renderedUserLocation.longitude,
        );
        const headingDelta = Math.abs(((targetUserLocation.heading - renderedUserLocation.heading + 540) % 360) - 180);

        if (distance < 0.000002 && headingDelta < 0.8) {
            renderedUserLocation = { ...targetUserLocation };
            renderUserLocationFeature(renderedUserLocation);
            userLocationRenderFrame = null;
            return;
        }

        userLocationRenderFrame = window.requestAnimationFrame(step);
    };

    userLocationRenderFrame = window.requestAnimationFrame(step);
}

function interpolateBearing(current, target, factor) {
    const delta = ((target - current + 540) % 360) - 180;
    return (current + (delta * factor) + 360) % 360;
}

export async function buildRouteToSpot(userLocation, spot, { camera = 'overview' } = {}) {
    if (!map || !userLocation || !spot) {
        throw new Error('Route cannot be built without map, user location and destination.');
    }

    const start = {
        latitude: Number(userLocation.latitude),
        longitude: Number(userLocation.longitude),
    };
    const finish = {
        latitude: Number(spot.latitude),
        longitude: Number(spot.longitude),
    };

    const directDistanceMeters = getDistanceMeters(start, finish);
    const cachedRoute = getCachedRoute(finish);
    const routeRequest = fetchTrafficRoute(start, finish, directDistanceMeters);
    const route = await (cachedRoute
        ? Promise.race([
            routeRequest,
            wait(1800).then(() => markRouteAsCached(cachedRoute)),
        ]).catch(() => markRouteAsCached(cachedRoute))
        : routeRequest.catch(() => buildFallbackRoute(start, finish)));
    const safeRoute = sanitizeRoute(route, start, finish);
    const source = map.getSource(ROUTE_SOURCE_ID);

    try {
        cacheRoute(finish, safeRoute);
    } catch {}

    setRouteTrafficMode(true);

    try {
        source?.setData(buildRouteFeatureCollection(safeRoute));
    } catch {
        const fallbackRoute = sanitizeRoute(buildFallbackRoute(start, finish), start, finish);
        source?.setData(buildRouteFeatureCollection(fallbackRoute));
        return fallbackRoute;
    }
    safeSetRouteLineColor(ROUTE_TRAFFIC_LINE_COLOR);
    keepNavigationLayersOrdered();

    if (camera === 'follow') {
        focusRouteStart(safeRoute.geometry.coordinates);
    } else if (camera !== 'none') {
        const bounds = new maplibregl.LngLatBounds();
        safeRoute.geometry.coordinates.forEach((coordinate) => bounds.extend(coordinate));
        safeFitBounds(bounds, {
            padding: getRoutePadding(),
            duration: 320,
            maxZoom: 16.5,
        });
    }

    return safeRoute;
}

function keepNavigationLayersOrdered() {
    const orderedTopLayers = [
        ROUTE_CASING_LAYER_ID,
        ROUTE_GLOW_LAYER_ID,
        ROUTE_LINE_LAYER_ID,
        ROUTE_HIGHLIGHT_LAYER_ID,
        'clusters',
        'spots-pin',
        'cluster-count',
        'fuel-station-cluster-glow',
        'fuel-station-cluster',
        'fuel-station-cluster-count',
        'fuel-station-glow',
        'fuel-station-pin',
        'fuel-station-price',
        'pending-spot',
        'personal-place-halo',
        'personal-place-dot',
        'personal-place-label',
        'user-location-accuracy',
        'user-location-dot',
        'user-navigation-dot',
        'speed-cameras',
        'speed-camera-direction',
        'speed-camera-label',
    ];

    try {
        if (map.getLayer(TRAFFIC_FLOW_LAYER_ID) && map.getLayer(ROUTE_CASING_LAYER_ID)) {
            map.moveLayer(TRAFFIC_FLOW_LAYER_ID, ROUTE_CASING_LAYER_ID);
        }

        orderedTopLayers.forEach((layerId) => {
            if (map.getLayer(layerId)) {
                map.moveLayer(layerId);
            }
        });
    } catch {}
}

function safeSetRouteLineColor(value) {
    try {
        if (map?.getLayer(ROUTE_LINE_LAYER_ID)) {
            map.setPaintProperty(ROUTE_LINE_LAYER_ID, 'line-color', value);
        }
    } catch {}
}

function safeEaseTo(options) {
    try {
        map?.stop();
        map?.easeTo(options);
    } catch {}
}

function safeFitBounds(bounds, options) {
    try {
        if (bounds?.isEmpty?.()) return;
        map?.stop();
        map?.fitBounds(bounds, options);
    } catch {}
}

function sanitizeRoute(route, start, finish) {
    const coordinates = sanitizeLineCoordinates(route?.geometry?.coordinates ?? []);
    const fallback = () => buildFallbackRoute(start, finish);

    if (coordinates.length < 2) {
        return fallback();
    }

    const segments = Array.isArray(route.segments)
        ? route.segments
            .map((segment) => ({
                ...segment,
                coordinates: smoothRouteLineCoordinates(sanitizeLineCoordinates(segment.coordinates ?? [])),
            }))
            .filter((segment) => segment.coordinates.length > 1)
        : [];
    const displayCoordinates = smoothRouteLineCoordinates(coordinates);

    return {
        ...route,
        geometry: {
            type: 'LineString',
            coordinates,
        },
        displayGeometry: {
            type: 'LineString',
            coordinates: displayCoordinates,
        },
        segments,
        distanceMeters: Number.isFinite(Number(route.distanceMeters))
            ? Number(route.distanceMeters)
            : getRouteDistanceMeters(coordinates),
        durationSeconds: Number.isFinite(Number(route.durationSeconds))
            ? Number(route.durationSeconds)
            : Math.max(60, getRouteDistanceMeters(coordinates) / 9),
    };
}

function smoothRouteLineCoordinates(coordinates) {
    const sanitized = sanitizeLineCoordinates(coordinates);

    if (sanitized.length < 3) {
        return sanitized;
    }

    const densified = densifyRouteCoordinates(sanitized, 18);

    return chaikinSmoothCoordinates(densified, 2);
}

function densifyRouteCoordinates(coordinates, maxSegmentMeters = 18) {
    const result = [];

    coordinates.forEach((coordinate, index) => {
        if (index === 0) {
            result.push(coordinate);
            return;
        }

        const previous = coordinates[index - 1];
        const distance = getDistanceMeters(
            { longitude: previous[0], latitude: previous[1] },
            { longitude: coordinate[0], latitude: coordinate[1] },
        );
        const steps = Math.max(1, Math.ceil(distance / maxSegmentMeters));

        for (let step = 1; step <= steps; step += 1) {
            const ratio = step / steps;
            result.push([
                previous[0] + ((coordinate[0] - previous[0]) * ratio),
                previous[1] + ((coordinate[1] - previous[1]) * ratio),
            ]);
        }
    });

    return result;
}

function chaikinSmoothCoordinates(coordinates, iterations = 2) {
    let result = coordinates;

    for (let iteration = 0; iteration < iterations; iteration += 1) {
        if (result.length < 3) {
            return result;
        }

        const next = [result[0]];

        for (let index = 0; index < result.length - 1; index += 1) {
            const start = result[index];
            const finish = result[index + 1];

            next.push([
                start[0] * 0.75 + finish[0] * 0.25,
                start[1] * 0.75 + finish[1] * 0.25,
            ]);
            next.push([
                start[0] * 0.25 + finish[0] * 0.75,
                start[1] * 0.25 + finish[1] * 0.75,
            ]);
        }

        next.push(result[result.length - 1]);
        result = next;
    }

    return result;
}

function sanitizeLineCoordinates(coordinates) {
    if (!Array.isArray(coordinates)) {
        return [];
    }

    return coordinates
        .map((coordinate) => {
            const longitude = Number(coordinate?.[0]);
            const latitude = Number(coordinate?.[1]);

            return Number.isFinite(longitude) && Number.isFinite(latitude)
                ? [longitude, latitude]
                : null;
        })
        .filter(Boolean);
}

function getRouteDistanceMeters(coordinates) {
    return coordinates.reduce((distance, coordinate, index) => {
        if (index === 0) return 0;

        const previous = coordinates[index - 1];

        return distance + getDistanceMeters(
            { longitude: previous[0], latitude: previous[1] },
            { longitude: coordinate[0], latitude: coordinate[1] },
        );
    }, 0);
}

function buildRouteFeatureCollection(route) {
    const routeCoordinates = sanitizeLineCoordinates(
        route?.displayGeometry?.coordinates ?? route?.geometry?.coordinates ?? [],
    );

    if (routeCoordinates.length < 2) {
        return buildFeatureCollection([]);
    }

    const segmentFeatures = Array.isArray(route.segments) && route.segments.length > 0
        ? route.segments
            .map((segment) => ({
                type: 'Feature',
                properties: {
                    traffic: segment.traffic ?? 'free',
                },
                geometry: {
                    type: 'LineString',
                    coordinates: sanitizeLineCoordinates(segment.coordinates ?? []),
                },
            }))
            .filter((feature) => feature.geometry.coordinates.length > 1)
        : [];

    if (segmentFeatures.length > 0) {
        return {
            type: 'FeatureCollection',
            features: segmentFeatures,
        };
    }

    return {
        type: 'FeatureCollection',
        features: [{
            type: 'Feature',
            properties: {
                traffic: 'free',
            },
            geometry: {
                type: 'LineString',
                coordinates: routeCoordinates,
            },
        }],
    };
}

export function clearActiveRoute() {
    map?.getSource(ROUTE_SOURCE_ID)?.setData(buildFeatureCollection([]));
    setRouteTrafficMode(false);
    clearRouteManeuverHint();
}

export function restoreActiveRoute(route) {
    if (!map || !route?.geometry?.coordinates?.length) {
        return;
    }

    const coordinates = sanitizeLineCoordinates(route.geometry.coordinates);

    if (coordinates.length < 2) {
        return;
    }

    const displayCoordinates = smoothRouteLineCoordinates(coordinates);

    map.getSource(ROUTE_SOURCE_ID)?.setData(buildRouteFeatureCollection({
        ...route,
        geometry: {
            type: 'LineString',
            coordinates,
        },
        displayGeometry: {
            type: 'LineString',
            coordinates: displayCoordinates,
        },
    }));
    safeSetRouteLineColor(ROUTE_TRAFFIC_LINE_COLOR);
    setRouteTrafficMode(true);
    keepNavigationLayersOrdered();
}

function setRouteTrafficMode(isActive) {
    isTrafficSuppressedByRoute = isActive;
    setTrafficLayerVisibility(isTrafficLayerEnabled());
}

export function updateActiveRouteProgress(userLocation, route) {
    if (!map || !route?.geometry?.coordinates?.length || !userLocation) {
        return;
    }

    const routeCoordinates = sanitizeLineCoordinates(route.geometry.coordinates);

    if (routeCoordinates.length < 2) {
        return;
    }

    const progressMeters = Number(userLocation?.routeProgressMeters);
    const visualRoute = Number.isFinite(progressMeters)
        ? trimRouteByProgress({
            ...route,
            geometry: {
                ...route.geometry,
                coordinates: routeCoordinates,
            },
            displayGeometry: undefined,
        }, Math.max(0, progressMeters - 6))
        : {
            ...route,
            geometry: {
                ...route.geometry,
                coordinates: routeCoordinates,
            },
            displayGeometry: undefined,
        };

    map.getSource(ROUTE_SOURCE_ID)?.setData(buildRouteFeatureCollection({
        ...visualRoute,
        displayGeometry: {
            type: 'LineString',
            coordinates: smoothRouteLineCoordinates(visualRoute.geometry.coordinates),
        },
        segments: Array.isArray(visualRoute.segments)
            ? visualRoute.segments.map((segment) => ({
                ...segment,
                coordinates: smoothRouteLineCoordinates(segment.coordinates ?? []),
            }))
            : [],
    }));
    safeSetRouteLineColor(ROUTE_TRAFFIC_LINE_COLOR);
}

export function updateRouteManeuverHint(instruction, route, hint = {}) {
    if (!map || !instruction || !route?.geometry?.coordinates?.length) {
        clearRouteManeuverHint();
        return;
    }

    const remainingMeters = Number(instruction.remainingMeters);
    const instructionDistanceMeters = Math.max(Number(instruction.distanceMeters) || 0, 0);
    const instructionStartMeters = Number(instruction.distanceFromStartMeters);

    const targetProgressMeters = instructionStartMeters;
    const coordinate = getRouteManeuverCoordinate(route.geometry.coordinates, targetProgressMeters, {
        scanMeters: Math.max(45, Math.min(220, instructionDistanceMeters || 90)),
    });

    if (!coordinate || !Number.isFinite(Number(coordinate[0])) || !Number.isFinite(Number(coordinate[1]))) {
        clearRouteManeuverHint();
        return;
    }

    routeManeuverCoordinate = [Number(coordinate[0]), Number(coordinate[1])];

    if (!routeManeuverMarker) {
        const element = document.createElement('div');
        element.className = 'route-maneuver-hint';
        element.innerHTML = `
            <div class="route-maneuver-hint__icon" aria-hidden="true"></div>
            <div class="route-maneuver-hint__copy">
                <strong></strong>
                <span></span>
            </div>
        `;
        routeManeuverMarker = new maplibregl.Marker({
            element,
            anchor: 'bottom',
            offset: [0, -10],
            pitchAlignment: 'viewport',
            rotationAlignment: 'viewport',
        }).setLngLat(coordinate).addTo(map);
    }

    const element = routeManeuverMarker.getElement();
    const icon = element.querySelector('.route-maneuver-hint__icon');
    const distance = element.querySelector('strong');
    const text = element.querySelector('span');

    if (icon) icon.innerHTML = hint.iconSvg ?? '';
    if (distance) distance.textContent = hint.distanceText ?? '';
    if (text) text.textContent = hint.text ?? '';

    try {
        routeManeuverMarker.setLngLat(routeManeuverCoordinate);
    } catch {
        clearRouteManeuverHint();
    }
}

export function clearRouteManeuverHint() {
    routeManeuverMarker?.remove();
    routeManeuverMarker = null;
    routeManeuverCoordinate = null;
}

function getRouteCoordinateAtProgress(coordinates, targetProgressMeters) {
    const target = Number(targetProgressMeters);
    const routeCoordinates = sanitizeLineCoordinates(coordinates);

    if (!Number.isFinite(target) || target < 0 || routeCoordinates.length < 2) {
        return null;
    }

    let progress = 0;

    for (let index = 1; index < routeCoordinates.length; index += 1) {
        const start = routeCoordinates[index - 1];
        const finish = routeCoordinates[index];
        const segmentDistance = getDistanceMeters(
            { longitude: start[0], latitude: start[1] },
            { longitude: finish[0], latitude: finish[1] },
        );

        if (progress + segmentDistance >= target) {
            const ratio = segmentDistance > 0 ? Math.max(0, Math.min(1, (target - progress) / segmentDistance)) : 0;

            return [
                Number(start[0]) + ((Number(finish[0]) - Number(start[0])) * ratio),
                Number(start[1]) + ((Number(finish[1]) - Number(start[1])) * ratio),
            ];
        }

        progress += segmentDistance;
    }

    return routeCoordinates.at(-1) ?? null;
}

function trimRouteByProgress(route, progressMeters) {
    const target = Number(progressMeters);
    const routeCoordinates = sanitizeLineCoordinates(route?.geometry?.coordinates ?? []);

    if (!Number.isFinite(target) || target <= 0 || routeCoordinates.length < 2) {
        return route;
    }

    const coordinates = getLineCoordinatesAfterProgress(routeCoordinates, target);
    const segments = Array.isArray(route.segments) && route.segments.length > 0
        ? trimRouteTrafficSegments(route.segments, target)
        : [];

    return {
        ...route,
        geometry: {
            ...route.geometry,
            coordinates,
        },
        segments,
    };
}

function trimRouteTrafficSegments(segments, progressMeters) {
    let accumulatedMeters = 0;

    return segments
        .map((segment) => {
            const coordinates = sanitizeLineCoordinates(segment.coordinates ?? []);
            const distanceMeters = getRouteDistanceMeters(coordinates);
            const segmentStartMeters = accumulatedMeters;
            accumulatedMeters += distanceMeters;

            if (coordinates.length < 2 || segmentStartMeters + distanceMeters <= progressMeters) {
                return null;
            }

            return {
                ...segment,
                coordinates: progressMeters > segmentStartMeters
                    ? getLineCoordinatesAfterProgress(coordinates, progressMeters - segmentStartMeters)
                    : coordinates,
            };
        })
        .filter((segment) => segment?.coordinates?.length > 1);
}

function getLineCoordinatesAfterProgress(coordinates, targetProgressMeters) {
    const routeCoordinates = sanitizeLineCoordinates(coordinates);
    const target = Math.max(0, Number(targetProgressMeters) || 0);

    if (routeCoordinates.length < 2 || target <= 0) {
        return routeCoordinates;
    }

    let progress = 0;
    const remaining = [];

    for (let index = 1; index < routeCoordinates.length; index += 1) {
        const start = routeCoordinates[index - 1];
        const finish = routeCoordinates[index];
        const segmentDistance = getDistanceMeters(
            { longitude: start[0], latitude: start[1] },
            { longitude: finish[0], latitude: finish[1] },
        );
        const segmentEnd = progress + segmentDistance;

        if (segmentEnd >= target) {
            const ratio = segmentDistance > 0 ? Math.max(0, Math.min(1, (target - progress) / segmentDistance)) : 0;
            remaining.push([
                Number(start[0]) + ((Number(finish[0]) - Number(start[0])) * ratio),
                Number(start[1]) + ((Number(finish[1]) - Number(start[1])) * ratio),
            ]);
            remaining.push(finish);
        } else if (remaining.length > 0) {
            remaining.push(finish);
        }

        progress = segmentEnd;
    }

    return remaining.length > 1 ? remaining : routeCoordinates.slice(-2);
}

function getRouteCoordinateIndexAtProgress(coordinates, targetProgressMeters) {
    const target = Number(targetProgressMeters);
    const routeCoordinates = sanitizeLineCoordinates(coordinates);

    if (!Number.isFinite(target) || target <= 0 || routeCoordinates.length < 2) {
        return 0;
    }

    let progress = 0;

    for (let index = 1; index < routeCoordinates.length; index += 1) {
        const start = routeCoordinates[index - 1];
        const finish = routeCoordinates[index];
        progress += getDistanceMeters(
            { longitude: start[0], latitude: start[1] },
            { longitude: finish[0], latitude: finish[1] },
        );

        if (progress >= target) {
            return index - 1;
        }
    }

    return Math.max(0, routeCoordinates.length - 2);
}

function getRouteManeuverCoordinate(coordinates, targetProgressMeters, { scanMeters = 120 } = {}) {
    const routeCoordinates = sanitizeLineCoordinates(coordinates);
    const target = Number(targetProgressMeters);

    if (!Number.isFinite(target) || routeCoordinates.length < 3) {
        return getRouteCoordinateAtProgress(routeCoordinates, targetProgressMeters);
    }

    let progress = 0;
    let best = null;

    for (let index = 1; index < routeCoordinates.length - 1; index += 1) {
        const previous = routeCoordinates[index - 1];
        const current = routeCoordinates[index];
        const next = routeCoordinates[index + 1];
        const segmentDistance = getDistanceMeters(
            { longitude: previous[0], latitude: previous[1] },
            { longitude: current[0], latitude: current[1] },
        );

        progress += segmentDistance;

        if (progress < target - 18) {
            continue;
        }

        if (progress > target + scanMeters) {
            break;
        }

        const turnAngle = Math.abs(getBearingDelta(
            getBearing(previous, current),
            getBearing(current, next),
        ));

        if (turnAngle < 18) {
            continue;
        }

        if (!best || turnAngle > best.turnAngle) {
            best = { coordinate: current, turnAngle };
        }
    }

    return best?.coordinate ?? getRouteCoordinateAtProgress(routeCoordinates, targetProgressMeters);
}

function getBearingDelta(from, to) {
    return ((to - from + 540) % 360) - 180;
}

export function startRouteNavigation(route) {
    const coordinates = sanitizeLineCoordinates(route?.geometry?.coordinates ?? []);

    if (coordinates.length < 2) {
        return;
    }

    focusRouteStart(coordinates);
}

export function focusNavigationPosition(userLocation, route = null, { preserveZoom = false, duration = 850, bearing = null } = {}) {
    if (!map || !userLocation) {
        return;
    }

    const routeCoordinates = sanitizeLineCoordinates(route?.geometry?.coordinates ?? []);
    const routeAnchor = getNavigationRouteAnchor(userLocation, routeCoordinates);
    const current = routeAnchor?.coordinate
        ? routeAnchor.coordinate
        : [Number(userLocation.longitude), Number(userLocation.latitude)];
    const progress = Number(routeAnchor?.progressMeters);
    const cameraCenter = Number.isFinite(progress)
        ? (getRouteCoordinateAtProgress(routeCoordinates, progress + FOLLOW_CENTER_LOOKAHEAD_METERS) ?? current)
        : current;
    const cameraBearing = Number.isFinite(progress)
        ? getNavigationRouteForwardBearing(routeCoordinates, progress, current)
        : getNavigationCameraBearing(userLocation, routeCoordinates);

    safeEaseTo({
        center: cameraCenter,
        zoom: preserveZoom ? map.getZoom() : FOLLOW_ZOOM,
        pitch: FOLLOW_PITCH,
        bearing: bearing !== null && bearing !== undefined && Number.isFinite(Number(bearing))
            ? Number(bearing)
            : (Number.isFinite(cameraBearing) ? cameraBearing : map.getBearing()),
        padding: { top: 0, right: 0, bottom: 0, left: 0 },
        retainPadding: false,
        offset: [0, Math.round(window.innerHeight * getNavigationScreenOffsetRatio())],
        duration,
    });
}

function getNavigationScreenOffsetRatio() {
    if (window.innerWidth >= 900) {
        return 0.20;
    }

    return FOLLOW_SCREEN_OFFSET_RATIO;
}

function getNavigationRouteForwardBearing(routeCoordinates, progressMeters, current) {
    const progress = Number(progressMeters);

    if (!Number.isFinite(progress) || routeCoordinates.length < 2) {
        return null;
    }

    const anchor = current ?? getRouteCoordinateAtProgress(routeCoordinates, progress);

    if (!anchor) {
        return null;
    }

    const lookaheads = [
        FOLLOW_BEARING_LOOKAHEAD_METERS,
        75,
        110,
        160,
        230,
    ];

    for (const meters of lookaheads) {
        const ahead = getRouteCoordinateAtProgress(routeCoordinates, progress + meters);

        if (!ahead) {
            continue;
        }

        const distance = getDistanceMeters(
            { longitude: anchor[0], latitude: anchor[1] },
            { longitude: ahead[0], latitude: ahead[1] },
        );

        if (distance >= 8) {
            return getBearing(anchor, ahead);
        }
    }

    return null;
}

function getNavigationRouteAnchor(userLocation, routeCoordinates) {
    const progress = Number(userLocation?.routeProgressMeters);

    if (routeCoordinates.length > 1 && Number.isFinite(progress)) {
        const coordinate = getRouteCoordinateAtProgress(routeCoordinates, progress);
        const ahead = getRouteCoordinateAtProgress(routeCoordinates, progress + 120);
        const bearing = coordinate && ahead ? getBearing(coordinate, ahead) : Number(userLocation?.routeBearing);

        if (coordinate && Number.isFinite(Number(coordinate[0])) && Number.isFinite(Number(coordinate[1]))) {
            return {
                coordinate: [Number(coordinate[0]), Number(coordinate[1])],
                progressMeters: progress,
                bearing: Number.isFinite(bearing) ? bearing : null,
            };
        }
    }

    const projection = getClosestRouteProjection(routeCoordinates, userLocation);

    if (!projection) {
        return null;
    }

    const coordinate = [Number(projection.longitude), Number(projection.latitude)];
    const ahead = getRouteCoordinateAtProgress(routeCoordinates, Number(projection.progressMeters) + 120);
    const bearing = ahead ? getBearing(coordinate, ahead) : Number(projection.bearing);

    return {
        coordinate,
        progressMeters: Number(projection.progressMeters),
        bearing: Number.isFinite(bearing) ? bearing : Number(projection.bearing),
    };
}

function getNavigationCameraBearing(userLocation, routeCoordinates, routeProjection = null) {
    const projectedCurrent = routeProjection
        ? [Number(routeProjection.longitude), Number(routeProjection.latitude)]
        : [Number(userLocation?.longitude), Number(userLocation?.latitude)];
    const progress = Number.isFinite(Number(routeProjection?.progressMeters))
        ? Number(routeProjection.progressMeters)
        : Number(userLocation?.routeProgressMeters);

    if (routeCoordinates.length > 1 && Number.isFinite(progress)) {
        const ahead = getRouteCoordinateAtProgress(routeCoordinates, progress + 120);

        if (ahead && Number.isFinite(projectedCurrent[0]) && Number.isFinite(projectedCurrent[1])) {
            const bearing = getBearing(projectedCurrent, ahead);
            if (Number.isFinite(bearing)) {
                return bearing;
            }
        }
    }

    const projectionBearing = Number(routeProjection?.bearing);
    if (Number.isFinite(projectionBearing)) {
        return projectionBearing;
    }

    const routeBearing = Number(userLocation?.routeBearing);
    if (Number.isFinite(routeBearing)) {
        return routeBearing;
    }

    if (routeCoordinates.length > 1) {
        const nextIndex = Math.min(findClosestRouteCoordinateIndex(projectedCurrent, routeCoordinates) + 1, routeCoordinates.length - 1);
        const next = routeCoordinates[nextIndex];

        return next ? getBearing(projectedCurrent, next) : null;
    }

    return null;
}

function findClosestRouteCoordinateIndex(current, coordinates) {
    const routeCoordinates = sanitizeLineCoordinates(coordinates);
    let bestIndex = 0;
    let bestDistance = Number.POSITIVE_INFINITY;

    routeCoordinates.forEach((coordinate, index) => {
        const distance = ((coordinate[0] - current[0]) ** 2) + ((coordinate[1] - current[1]) ** 2);

        if (distance < bestDistance) {
            bestDistance = distance;
            bestIndex = index;
        }
    });

    return bestIndex;
}

async function fetchTrafficRoute(start, finish, directDistanceMeters) {
    try {
        const route = await fetchYandexDrivingRoute(start, finish);

        if (route?.geometry?.coordinates?.length) {
            return route;
        }
    } catch {
        // Fall through to public OSRM only when Yandex is unavailable or not configured.
    }

    return fetchOpenStreetMapRoute(start, finish, directDistanceMeters);
}

async function fetchOpenStreetMapRoute(start, finish, directDistanceMeters) {
    const path = `${start.longitude},${start.latitude};${finish.longitude},${finish.latitude}?overview=full&geometries=geojson&steps=true`;
    const urls = [
        `https://router.project-osrm.org/route/v1/driving/${path}`,
        `https://routing.openstreetmap.de/routed-car/route/v1/driving/${path}`,
    ];
    const timeout = directDistanceMeters > 100000 ? 14000 : 8000;
    const response = await Promise.any(urls.map((url) => fetchWithTimeout(url, timeout)));

    if (!response.ok) {
        throw new Error('Route service failed.');
    }

    const payload = await response.json();
    const route = payload.routes?.[0];

    if (!route?.geometry?.coordinates?.length) {
        throw new Error('Route service returned empty route.');
    }

    return {
        geometry: route.geometry,
        instructions: buildOsrmInstructions(route),
        distanceMeters: route.distance,
        durationSeconds: route.duration,
        source: 'road',
    };
}

function buildOsrmInstructions(route) {
    let distanceFromStart = 0;

    return (route.legs ?? []).flatMap((leg) => (
        (leg.steps ?? []).map((step) => {
            const instruction = {
                text: formatOsrmInstruction(step),
                roadName: step.name || '',
                distanceMeters: Number(step.distance) || 0,
                durationSeconds: Number(step.duration) || 0,
                distanceFromStartMeters: distanceFromStart,
                maneuver: step.maneuver?.type || '',
                modifier: step.maneuver?.modifier || '',
            };

            distanceFromStart += instruction.distanceMeters;

            return instruction;
        })
    )).filter((instruction) => instruction.text);
}

function formatOsrmInstruction(step) {
    const roadName = step.name ? ` на ${step.name}` : '';
    const modifier = {
        left: 'налево',
        right: 'направо',
        slight_left: 'левее',
        slight_right: 'правее',
        sharp_left: 'резко налево',
        sharp_right: 'резко направо',
        straight: 'прямо',
        uturn: 'развернитесь',
    }[step.maneuver?.modifier] ?? '';

    return {
        depart: `Начните движение${roadName}`,
        turn: `Поверните ${modifier || 'по маршруту'}${roadName}`,
        'new name': `Продолжайте${roadName}`,
        continue: `Продолжайте ${modifier || 'прямо'}${roadName}`,
        merge: `Выезжайте ${modifier || 'по маршруту'}${roadName}`,
        ramp: `Съезд ${modifier || 'по маршруту'}${roadName}`,
        fork: `Держитесь ${modifier || 'по маршруту'}${roadName}`,
        roundabout: `На круговом движении продолжайте${roadName}`,
        rotary: `На круговом движении продолжайте${roadName}`,
        arrive: 'Вы прибыли',
    }[step.maneuver?.type] ?? `Двигайтесь по маршруту${roadName}`;
}

function focusRouteStart(coordinates) {
    const routeCoordinates = sanitizeLineCoordinates(coordinates);
    const start = routeCoordinates[0];

    if (!start) return;

    const routeBearing = getNavigationRouteForwardBearing(routeCoordinates, 0, start);

    safeEaseTo({
        center: start,
        zoom: FOLLOW_ZOOM,
        pitch: FOLLOW_PITCH,
        bearing: Number.isFinite(routeBearing) ? routeBearing : map.getBearing(),
        offset: [0, Math.round(window.innerHeight * getNavigationScreenOffsetRatio())],
        duration: 420,
    });
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

async function fetchWithTimeout(url, timeout) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeout);

    try {
        const response = await fetch(url, { signal: controller.signal });

        if (!response.ok) {
            throw new Error('Route service failed.');
        }

        return response;
    } finally {
        window.clearTimeout(timer);
    }
}

function getRoutePadding() {
    const isCompact = window.matchMedia('(max-width: 520px)').matches;

    return isCompact
        ? { top: 72, right: 44, bottom: 190, left: 44 }
        : { top: 84, right: 84, bottom: 138, left: 84 };
}

function buildFallbackRoute(start, finish) {
    const distanceMeters = getDistanceMeters(start, finish);

    return {
        geometry: {
            type: 'LineString',
            coordinates: [
                [start.longitude, start.latitude],
                [finish.longitude, finish.latitude],
            ],
        },
        instructions: [{
            text: 'Двигайтесь к точке назначения',
            distanceMeters,
            distanceFromStartMeters: 0,
        }],
        distanceMeters,
        durationSeconds: distanceMeters / 9,
        source: 'approximate',
    };
}

function wait(timeoutMs) {
    return new Promise((resolve) => {
        window.setTimeout(resolve, timeoutMs);
    });
}

function markRouteAsCached(route) {
    return {
        ...route,
        source: String(route.source || 'road').endsWith('-cached')
            ? route.source
            : `${route.source || 'road'}-cached`,
    };
}

function cacheRoute(finish, route) {
    if (!route?.geometry?.coordinates?.length || route.source === 'approximate') {
        return;
    }

    window.localStorage?.setItem(ROUTE_CACHE_STORAGE_KEY, JSON.stringify({
        finish,
        route,
        savedAt: Date.now(),
    }));
}

function getCachedRoute(finish) {
    const cached = readCachedRoute();

    if (!cached?.route?.geometry?.coordinates?.length || !cached.finish || Date.now() - Number(cached.savedAt) > 86400000) {
        return null;
    }

    const distanceToDestination = getDistanceMeters(
        {
            latitude: Number(cached.finish.latitude),
            longitude: Number(cached.finish.longitude),
        },
        finish,
    );

    return distanceToDestination < 40 ? cached.route : null;
}

function readCachedRoute() {
    try {
        return JSON.parse(window.localStorage?.getItem(ROUTE_CACHE_STORAGE_KEY) || 'null');
    } catch {
        return null;
    }
}

function getDistanceMeters(start, finish) {
    const radius = 6371000;
    const lat1 = toRadians(start.latitude);
    const lat2 = toRadians(finish.latitude);
    const deltaLat = toRadians(finish.latitude - start.latitude);
    const deltaLon = toRadians(finish.longitude - start.longitude);
    const a = Math.sin(deltaLat / 2) ** 2
        + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;

    return 2 * radius * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRadians(value) {
    return Number(value) * Math.PI / 180;
}

export function clearPendingSelection() {
    pendingMarker = null;
    updatePendingSource();
}

export function setMapPickingMode(isActive) {
    isPickingMode = isActive;
    setMapCursor(isActive ? 'crosshair' : '');
}

export function setRouteDestinationPickingMode(isActive) {
    isRouteDestinationPickingMode = isActive;
    setMapCursor(isActive ? 'crosshair' : (isPickingMode ? 'crosshair' : ''));
}

async function selectRouteDestination(lngLat) {
    const coords = [Number(lngLat.lat), Number(lngLat.lng)];
    setPendingCoords(coords);
    setRouteDestinationPickingMode(false);
    window.dispatchEvent(new CustomEvent('navigator:destination-loading', {
        detail: {
            latitude: coords[0],
            longitude: coords[1],
        },
    }));

    try {
        const response = await reverseGeocode(coords[0], coords[1]);
        window.dispatchEvent(new CustomEvent('navigator:destination-selected', {
            detail: {
                latitude: coords[0],
                longitude: coords[1],
                address: typeof response.address === 'string' ? response.address.trim() : '',
            },
        }));
    } catch {
        window.dispatchEvent(new CustomEvent('navigator:destination-selected', {
            detail: {
                latitude: coords[0],
                longitude: coords[1],
                address: '',
            },
        }));
    }
}

async function resolveAddress(coords) {
    const requestId = ++addressRequestId;
    window.dispatchEvent(new CustomEvent('map:address-loading'));

    try {
        const response = await reverseGeocode(coords[0], coords[1]);
        const address = typeof response.address === 'string' ? response.address.trim() : '';

        if (requestId !== addressRequestId) {
            return;
        }

        window.dispatchEvent(new CustomEvent('map:address-resolved', {
            detail: {
                address,
                latitude: coords[0],
                longitude: coords[1],
            },
        }));
    } catch {
        if (requestId !== addressRequestId) {
            return;
        }

        window.dispatchEvent(new CustomEvent('map:address-resolved', {
            detail: {
                address: '',
                latitude: coords[0],
                longitude: coords[1],
            },
        }));
    }
}

function renderParkingSpots(spots) {
    spotsCache = spots;
    const source = map?.getSource(SOURCE_ID);

    if (source) {
        source.setData(buildFeatureCollection(spots));
    }
}

function buildFeatureCollection(spots) {
    return {
        type: 'FeatureCollection',
        features: spots.map((spot) => ({
            type: 'Feature',
            properties: {
                spotId: Number(spot.id),
                status: getAvailabilityStatus(spot),
                markerColor: getMarkerColor(spot),
                markerHalo: getMarkerHalo(spot),
                heading: Number.isFinite(Number(spot.heading)) ? Number(spot.heading) : 0,
            },
            geometry: {
                type: 'Point',
                coordinates: [Number(spot.longitude), Number(spot.latitude)],
            },
        })),
    };
}

function normalizeFuelStations(stations) {
    const seen = new Set();

    return (Array.isArray(stations) ? stations : [])
        .filter((station) => {
            const longitude = Number(station?.longitude);
            const latitude = Number(station?.latitude);
            const id = getFuelStationId(station);

            if (
                !Number.isFinite(longitude)
                || !Number.isFinite(latitude)
                || Math.abs(longitude) > 180
                || Math.abs(latitude) > 90
                || seen.has(id)
            ) {
                return false;
            }

            seen.add(id);
            return true;
        })
        .slice(0, 1500);
}

function renderFuelStations(stations) {
    const normalized = normalizeFuelStations(stations);
    renderedFuelStationIds = new Set(normalized.map(getFuelStationId));
    closeFuelStationPopup();
    map?.getSource(FUEL_STATION_SOURCE_ID)?.setData(buildFuelStationFeatureCollection(normalized));
}

function getFuelStationId(station) {
    const longitude = Number(station?.longitude);
    const latitude = Number(station?.latitude);

    return String(station?.id ?? `${longitude.toFixed(5)}:${latitude.toFixed(5)}`);
}

function getFuelStationsCacheKey(bounds) {
    return [
        bounds.getWest(),
        bounds.getSouth(),
        bounds.getEast(),
        bounds.getNorth(),
    ].map((value) => Number(value).toFixed(2)).join(':');
}

function cacheFuelStations(key, stations) {
    fuelStationsCache.delete(key);
    fuelStationsCache.set(key, { stations, savedAt: Date.now() });

    while (fuelStationsCache.size > FUEL_STATION_CACHE_LIMIT) {
        fuelStationsCache.delete(fuelStationsCache.keys().next().value);
    }
}

function buildFuelStationFeatureCollection(stations) {
    return {
        type: 'FeatureCollection',
        features: stations
            .map((station) => {
                const longitude = Number(station.longitude);
                const latitude = Number(station.latitude);
                if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null;
                const prices = station.prices || {};
                const hasPrices = Object.keys(prices).length > 0;

                return {
                    type: 'Feature',
                    properties: {
                        stationId: getFuelStationId(station),
                        name: station.name || 'АЗС',
                        brand: station.brand || '',
                        address: station.address || '',
                        availability: 'unknown',
                        priceLabel: hasPrices
                            ? station.priceLabel
                            : (station.brand || station.name || 'АЗС'),
                        pricesJson: JSON.stringify(prices),
                        openingHours: station.openingHours || '',
                        updatedAt: station.updatedAt || '',
                        osmUrl: station.osmUrl || '',
                        priceSource: station.priceSource || '',
                    },
                    geometry: {
                        type: 'Point',
                        coordinates: [longitude, latitude],
                    },
                };
            })
            .filter(Boolean),
    };
}

function updateFuelLayerMenuState(state, count = 0) {
    const button = document.querySelector('[data-fuel-layer-toggle]');
    const status = button?.querySelector('[data-fuel-layer-status]');
    if (!button || !status) return;

    const labels = {
        off: 'Выключены',
        loading: 'Включены · загружаем · парковки скрыты',
        refreshing: 'Включены · обновляем данные · парковки скрыты',
        ready: `Включены · ${count} на карте · парковки скрыты`,
        empty: 'Включены · рядом не найдено · парковки скрыты',
        zoom: 'Включены · приблизьте карту · парковки скрыты',
        stale: `Включены · показаны последние данные · парковки скрыты`,
        error: 'Включены · данные временно недоступны · парковки скрыты',
    };

    button.dataset.state = state;
    status.textContent = labels[state] ?? labels.off;
    button.setAttribute(
        'aria-label',
        isFuelLayerEnabled
            ? `Слой заправок включён. ${status.textContent}`
            : 'Включить слой заправок',
    );
}

function closeFuelStationPopup() {
    fuelStationPopup?.remove();
    fuelStationPopup = null;
}

function formatFuelUpdatedAt(value) {
    if (!value) return '';

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';

    return new Intl.DateTimeFormat('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
    }).format(date);
}

function escapeMapHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

function escapeMapAttribute(value) {
    return escapeMapHtml(value).replaceAll('`', '&#096;');
}

function isSafeHttpUrl(value) {
    try {
        if (!String(value || '').trim()) return false;
        const url = new URL(String(value));

        return url.protocol === 'https:' || url.protocol === 'http:';
    } catch {
        return false;
    }
}

function setPendingCoords(coords) {
    pendingMarker = {
        latitude: coords[0],
        longitude: coords[1],
    };
    updatePendingSource();
}

function updatePendingSource() {
    const source = map?.getSource(PENDING_SOURCE_ID);
    const spots = pendingMarker ? [{ ...pendingMarker, id: 'pending', availability_status: 'new' }] : [];

    source?.setData(buildFeatureCollection(spots));
}

function getAvailabilityStatus(spot) {
    if (spot.availability_status) {
        return spot.availability_status;
    }

    return spot.is_verified ? 'verified' : 'unverified';
}

function getMarkerColor(spot) {
    return {
        verified: '#34D399',
        unverified: '#FFD166',
        temporary: '#A259FF',
        outdated: '#F87171',
        new: '#00D4FF',
    }[getAvailabilityStatus(spot)] ?? '#00D4FF';
}

function getMarkerHalo(spot) {
    return {
        verified: 'rgba(52, 211, 153, 0.24)',
        unverified: 'rgba(255, 209, 102, 0.28)',
        temporary: 'rgba(162, 89, 255, 0.28)',
        outdated: 'rgba(248, 113, 113, 0.28)',
        new: 'rgba(0, 212, 255, 0.30)',
    }[getAvailabilityStatus(spot)] ?? 'rgba(0, 212, 255, 0.30)';
}

