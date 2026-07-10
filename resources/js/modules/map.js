import maplibregl from 'maplibre-gl';
import {
    Box3,
    Camera,
    Color,
    DirectionalLight,
    Group,
    HemisphereLight,
    Matrix4,
    Scene,
    Vector3,
    WebGLRenderer,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
    fetchDrivingRoute as fetchYandexDrivingRoute,
    fetchFuelStations,
    fetchParkingSpots,
    reverseGeocode,
} from './parking-api';
import { getClosestRouteProjection, isManualMapInteraction } from './navigation-logic';
import { MAP_LAYER_IDS, applyMapUiTheme, normalizeMapLayerId } from './map-theme';
import { applyNavigationVehicleStyle, createNavigationVehicleModel } from './navigation-vehicle-models';
import { addRoadDetails } from '../utils/map/addRoadDetails';

let map = null;
let parkingSpotsLoadPromise = null;
let spotsCache = [];
let pendingMarker = null;
let addressRequestId = 0;
let userLocationRenderFrame = null;
let userLocationFeatureRefreshFrame = null;
let renderedUserLocation = null;
let targetUserLocation = null;
let userLocationModelLayer = null;
let isUserLocationModelLayerReady = false;
let isUserLocationModelLayerVisible = false;
let activeNavigationRouteCoordinates = [];
let isPickingMode = false;
let isRouteDestinationPickingMode = false;
let routeManeuverMarker = null;
let routeManeuverCoordinate = null;
let fuelStationsLoadTimer = null;
let fuelStationsRequestId = 0;
let fuelStationsAbortController = null;
let fuelStationsRetryTimer = null;
let fuelStationsCache = new Map();
let renderedFuelStationIds = new Set();
let fuelStationPopup = null;
let activeFuelStationId = null;
let fuelPopupCameraSnapshot = null;
let fuelPopupCameraTransitionUntil = 0;
let isFuelLayerEnabled = false;
let fuelStationsRateLimitedUntil = 0;

const MOSCOW_CENTER = [37.6173, 55.7558];
const MAP_DIAGNOSTICS_ENDPOINT = '/api/map-diagnostics';
const MAP_SLOW_BOOT_THRESHOLD_MS = 8000;
const MAP_STUCK_BOOT_THRESHOLD_MS = 18000;
const FUEL_STATION_SLOW_REQUEST_MS = 12000;
const MAP_CONTAINER_ID = 'parking-map';
const SOURCE_ID = 'parking-spots';
const PENDING_SOURCE_ID = 'pending-parking-spot';
const USER_LOCATION_SOURCE_ID = 'user-location';
const USER_LOCATION_MODEL_SOURCE_ID = 'user-location-3d-vehicle';
const USER_LOCATION_MODEL_LAYER_ID = 'user-location-3d-model';
const USER_LOCATION_MODEL_EXTRUSION_LAYERS = [
    'user-location-3d-shadow',
    'user-location-3d-body-fill',
    'user-location-3d-detail-fill',
    'user-location-3d-gloss-fill',
    'user-location-3d-body',
    'user-location-3d-cabin',
    'user-location-3d-glass',
    'user-location-3d-lights',
];
const ROUTE_SOURCE_ID = 'active-route';
const SPEED_CAMERA_SOURCE_ID = 'speed-cameras';
const FUEL_STATION_SOURCE_ID = 'fuel-stations';
const FUEL_STATION_MIN_ZOOM = 8.5;
const FUEL_STATION_CACHE_TTL_MS = 5 * 60 * 1000;
const FUEL_STATION_CACHE_LIMIT = 12;
const FUEL_STATION_RATE_LIMIT_FALLBACK_MS = 30000;
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
const GPS_CURSOR_ASSET_BASE = '/assets/gps-cursors/';
const GPS_CURSOR_MODEL_ASSET_BASE = `${GPS_CURSOR_ASSET_BASE}models/`;
const DEFAULT_USER_LOCATION_ICON_ID = 'auralith-nav-arrow';
const USER_LOCATION_ICON_OPTIONS = [
    { id: 'auralith-nav-arrow', label: 'Auralith arrow', image: `${GPS_CURSOR_ASSET_BASE}auralith-nav-arrow.png` },
    { id: 'auralith-nav-black', label: 'Black GT', image: `${GPS_CURSOR_ASSET_BASE}auralith-nav-black.png` },
    { id: 'auralith-nav-red', label: 'Red GT', image: `${GPS_CURSOR_ASSET_BASE}auralith-nav-red.png` },
    { id: 'auralith-nav-white', label: 'White GT', image: `${GPS_CURSOR_ASSET_BASE}auralith-nav-white.png` },
    { id: 'auralith-nav-cyan', label: 'Cyan EV', image: `${GPS_CURSOR_ASSET_BASE}auralith-nav-cyan.png` },
    { id: 'auralith-nav-graphite', label: 'Graphite SUV', image: `${GPS_CURSOR_ASSET_BASE}auralith-nav-graphite.png` },
];
const USER_LOCATION_GLB_MODELS = {
    'auralith-nav-black': `${GPS_CURSOR_MODEL_ASSET_BASE}toy-car.glb`,
    'auralith-nav-red': `${GPS_CURSOR_MODEL_ASSET_BASE}toy-car.glb`,
    'auralith-nav-white': `${GPS_CURSOR_MODEL_ASSET_BASE}toy-car.glb`,
    'auralith-nav-cyan': `${GPS_CURSOR_MODEL_ASSET_BASE}toy-car.glb`,
    'auralith-nav-graphite': `${GPS_CURSOR_MODEL_ASSET_BASE}toy-car.glb`,
};
const USER_LOCATION_GLB_MODEL_LENGTH_METERS = 4.15;
const userLocationGltfModelCache = new Map();
const DEFAULT_BASE_LAYER_ID = 'light';
const BASE_LAYER_STORAGE_KEY = 'auralith:map-layer';
const ROUTE_CACHE_STORAGE_KEY = 'auralith:last-driving-route';
const TRAFFIC_LAYER_STORAGE_KEY = 'auralith:traffic-enabled';
const FUEL_LAYER_STORAGE_KEY = 'auralith:fuel-layer-enabled';
const USER_LOCATION_ICON_STORAGE_KEY = 'auralith:user-location-icon';
const USER_LOCATION_ICON_PREFIX = 'user-location-';
const USER_LOCATION_MODEL_LENGTH_METERS = 6.2;
const USER_LOCATION_MODEL_ALTITUDE_METERS = 0.18;
const USER_LOCATION_MODEL_VISUAL_SCALE = 2.35;
const USER_LOCATION_MODEL_VERTICAL_SCALE = 2.85;
const USER_LOCATION_EXTRUSION_MODEL_SCALE = 0.54;
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
const mapDiagnostics = {
    startedAt: nowMs(),
    marks: { moduleLoaded: 0 },
    counters: {
        mapErrors: 0,
        tileFailures: 0,
        fuelErrors: 0,
    },
    details: {},
    sentReasons: new Set(),
};
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
                'text-font': ['Noto Sans Bold'],
                'text-size': ['interpolate', ['linear'], ['zoom'], 12, 10.5, 16, 13.5, 18, 14.5],
                'text-letter-spacing': 0.01,
                'text-rotation-alignment': 'map',
                'text-pitch-alignment': 'viewport',
                'text-keep-upright': true,
                'symbol-spacing': ['interpolate', ['linear'], ['zoom'], 12, 460, 17, 260],
                'text-allow-overlap': false,
            },
            paint: {
                'text-color': '#243247',
                'text-halo-color': 'rgba(246, 250, 255, 0.92)',
                'text-halo-width': 1.65,
                'text-halo-blur': 0.35,
                'text-opacity': 0.96,
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

function nowMs() {
    return typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now();
}

function markMapDiagnostic(name, detail = null) {
    if (!Object.prototype.hasOwnProperty.call(mapDiagnostics.marks, name)) {
        mapDiagnostics.marks[name] = Math.round(nowMs() - mapDiagnostics.startedAt);
    }

    if (detail !== null) {
        mapDiagnostics.details[name] = detail;
    }
}

function setMapDiagnosticDetail(name, value) {
    mapDiagnostics.details[name] = value;
}

function incrementMapDiagnosticCounter(name) {
    mapDiagnostics.counters[name] = Number(mapDiagnostics.counters[name] || 0) + 1;
}

function scheduleMapDiagnosticsWatchdog() {
    window.setTimeout(() => {
        if (!mapDiagnostics.marks.mapReady) {
            sendMapDiagnostics('map_slow_boot');
        }
    }, MAP_SLOW_BOOT_THRESHOLD_MS);

    window.setTimeout(() => {
        if (!mapDiagnostics.marks.mapReady) {
            sendMapDiagnostics('map_stuck_boot', {}, { force: true });
        }
    }, MAP_STUCK_BOOT_THRESHOLD_MS);
}

function sendMapDiagnostics(reason, details = {}, { force = false } = {}) {
    if (!force && mapDiagnostics.sentReasons.has(reason)) {
        return;
    }

    if (mapDiagnostics.sentReasons.size >= 4) {
        return;
    }

    mapDiagnostics.sentReasons.add(reason);

    const payload = {
        reason,
        timings: mapDiagnostics.marks,
        counters: mapDiagnostics.counters,
        details: {
            ...mapDiagnostics.details,
            ...details,
        },
        device: getMapDiagnosticsDeviceInfo(),
        page: window.location.pathname,
    };

    fetch(MAP_DIAGNOSTICS_ENDPOINT, {
        method: 'POST',
        credentials: 'same-origin',
        keepalive: true,
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
    }).catch(() => {
        // Diagnostics must never affect the map experience.
    });
}

function getMapDiagnosticsDeviceInfo() {
    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    const device = {
        online: navigator.onLine,
        userAgent: navigator.userAgent,
        language: navigator.language,
        platform: navigator.platform,
        viewport: `${window.innerWidth}x${window.innerHeight}`,
        devicePixelRatio: window.devicePixelRatio || 1,
        hardwareConcurrency: navigator.hardwareConcurrency || null,
        deviceMemory: navigator.deviceMemory || null,
        webglSupported: isWebGlSupported(),
    };

    if (connection) {
        device.connection = {
            effectiveType: connection.effectiveType || null,
            downlink: connection.downlink || null,
            rtt: connection.rtt || null,
            saveData: Boolean(connection.saveData),
        };
    }

    if (map) {
        device.map = {
            loaded: typeof map.loaded === 'function' ? map.loaded() : null,
            zoom: Number(map.getZoom?.().toFixed(2)),
            pitch: Number(map.getPitch?.().toFixed(1)),
            bearing: Number(map.getBearing?.().toFixed(1)),
            fuelLayerEnabled: isFuelLayerEnabled,
            renderedFuelStations: renderedFuelStationIds.size,
        };
    }

    return device;
}

export async function initParkingMap() {
    if (!document.getElementById(MAP_CONTAINER_ID)) {
        return;
    }

    applyMapUiTheme(getSavedBaseMapLayer());
    markMapDiagnostic('initCalled');

    if (!isWebGlSupported()) {
        sendMapDiagnostics('webgl_unsupported', {}, { force: true });
        reportMapError('Карта не поддерживается в этом браузере. Попробуйте Chrome или Safari.', true);
        return;
    }

    try {
        markMapDiagnostic('initMapStart');
        initMapLibreMap();
    } catch (error) {
        console.error('Map init failed', error);
        incrementMapDiagnosticCounter('mapErrors');
        sendMapDiagnostics('map_init_failed', {
            message: String(error?.message || error),
        }, { force: true });
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

    markMapDiagnostic('mapConstructStart');

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

    markMapDiagnostic('mapConstructed');
    scheduleMapDiagnosticsWatchdog();

    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');

    map.on('error', (event) => {
        const message = String(event?.error?.message || event?.error || '');
        incrementMapDiagnosticCounter('mapErrors');

        if (message.includes('Failed to fetch') || message.includes('AJAXError')) {
            incrementMapDiagnosticCounter('tileFailures');
            if (mapDiagnostics.counters.tileFailures >= 4) {
                sendMapDiagnostics('map_tile_failures', { lastTileError: message });
            }
            console.warn('MapLibre tile/source request failed', message);
            return;
        }

        sendMapDiagnostics('maplibre_error', { message }, { force: true });
        console.warn('MapLibre error', event.error);
    });

    map.once('sourcedata', (event) => {
        markMapDiagnostic('firstSourceData', {
            sourceId: event?.sourceId || '',
            sourceDataType: event?.sourceDataType || '',
        });
    });

    map.once('idle', () => {
        markMapDiagnostic('firstIdle');
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
        markMapDiagnostic('mapLoad');
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
            addUserLocationModelLayer();
            ensureUserLocationModelLayerOnTop();
            if (ENABLE_ROAD_DETAILS) {
                addRoadDetails(map, {
                    baseRoadSource: ROAD_SOURCE_ID,
                    includeBaseRoadMarkings: false,
                });
            }
            removeRoadMarkingLayers();
            bindMapEvents();
            setFuelLayerEnabled(getSavedFuelLayerState(), { persist: false });
            markMapDiagnostic('mapReady');
            if (mapDiagnostics.marks.mapReady > MAP_SLOW_BOOT_THRESHOLD_MS) {
                sendMapDiagnostics('map_ready_slow');
            }
            window.dispatchEvent(new CustomEvent('map:ready'));
        } catch (error) {
            console.error('Map layers failed', error);
            incrementMapDiagnosticCounter('mapErrors');
            sendMapDiagnostics('map_layers_failed', {
                message: String(error?.message || error),
            }, { force: true });
            reportMapError('Не удалось отрисовать карту. Обновите страницу.', true);
            return;
        }

        try {
            scheduleParkingSpotsLoad();
        } catch (error) {
            incrementMapDiagnosticCounter('mapErrors');
            sendMapDiagnostics('parking_schedule_failed', {
                message: String(error?.message || error),
            }, { force: true });
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
    const startedAt = nowMs();
    markMapDiagnostic('parkingLoadStart');
    window.dispatchEvent(new CustomEvent('parking:loading'));
    try {
        const response = await fetchParkingSpots();
        renderParkingSpots(response.data);
        markMapDiagnostic('parkingLoaded');
        setMapDiagnosticDetail('parkingLoadMs', Math.round(nowMs() - startedAt));
        setMapDiagnosticDetail('parkingCount', Array.isArray(response.data) ? response.data.length : null);
        window.dispatchEvent(new CustomEvent('parking:loaded', { detail: response.data }));
    } catch (error) {
        incrementMapDiagnosticCounter('mapErrors');
        sendMapDiagnostics('parking_load_failed', {
            message: String(error?.message || error),
            parkingLoadMs: Math.round(nowMs() - startedAt),
        });
        throw error;
    }
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
    context.roundRect(24, 17, 58, 66, 16);
    context.fill();
    context.stroke();
    context.restore();

    context.fillStyle = coreColor;
    context.shadowColor = glowColor;
    context.shadowBlur = 11;
    context.beginPath();
    context.roundRect(34, 27, 36, 24, 7);
    context.fill();
    context.shadowColor = 'transparent';

    context.strokeStyle = '#EFFFFF';
    context.lineWidth = 5;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.beginPath();
    context.moveTo(37, 66);
    context.lineTo(69, 66);
    context.moveTo(44, 60);
    context.lineTo(44, 73);
    context.moveTo(62, 60);
    context.lineTo(62, 73);
    context.moveTo(82, 33);
    context.lineTo(92, 43);
    context.lineTo(92, 65);
    context.quadraticCurveTo(92, 73, 84, 73);
    context.lineTo(82, 73);
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
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 9, 15, 15],
            'circle-color': '#22D3EE',
            'circle-blur': 0.9,
            'circle-opacity': 0.26,
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
            'icon-size': ['interpolate', ['linear'], ['zoom'], 9, 0.52, 14, 0.72, 18, 0.86],
            'icon-anchor': 'center',
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
            'text-font': ['Noto Sans Regular'],
            'text-size': ['interpolate', ['linear'], ['zoom'], 11, 10, 16, 11.5, 18, 12.5],
            'text-letter-spacing': 0.01,
            'text-offset': [0, 1.75],
            'text-anchor': 'top',
            'text-allow-overlap': false,
            'text-optional': true,
        },
        paint: {
            'text-color': '#E6FFFF',
            'text-halo-color': 'rgba(3, 10, 24, 0.94)',
            'text-halo-width': 1.8,
            'text-halo-blur': 0.35,
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
    if (isFuelPopupCameraTransitionActive()) {
        window.clearTimeout(fuelStationsLoadTimer);
        return;
    }

    window.clearTimeout(fuelStationsLoadTimer);
    fuelStationsLoadTimer = window.setTimeout(loadFuelStationsInView, delay);
}

async function loadFuelStationsInView() {
    if (!isFuelLayerEnabled || !map) return;
    if (isFuelPopupCameraTransitionActive()) return;

    const rateLimitDelay = fuelStationsRateLimitedUntil - Date.now();
    if (rateLimitDelay > 0) {
        updateFuelLayerMenuState(renderedFuelStationIds.size ? 'stale' : 'loading', renderedFuelStationIds.size);
        window.clearTimeout(fuelStationsRetryTimer);
        fuelStationsRetryTimer = window.setTimeout(
            () => scheduleFuelStationsLoad(0),
            Math.min(rateLimitDelay + 250, FUEL_STATION_RATE_LIMIT_FALLBACK_MS),
        );
        return;
    }

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
    const requestBounds = getRoundedFuelStationBounds(bounds);
    const cacheKey = getFuelStationsCacheKey(requestBounds);
    const cached = fuelStationsCache.get(cacheKey);

    if (cached && Date.now() - cached.savedAt < FUEL_STATION_CACHE_TTL_MS) {
        renderFuelStations(cached.stations);
        updateFuelLayerMenuState(cached.stations.length ? 'ready' : 'empty', cached.stations.length);
        return;
    }

    const requestController = new AbortController();
    const requestTimeout = window.setTimeout(() => requestController.abort('timeout'), 45000);
    fuelStationsAbortController = requestController;
    updateFuelLayerMenuState(renderedFuelStationIds.size ? 'refreshing' : 'loading', renderedFuelStationIds.size);
    const fuelRequestStartedAt = nowMs();
    markMapDiagnostic('fuelRequestStart');
    setMapDiagnosticDetail('fuelRequestBounds', requestBounds);

    try {
        let fastStations = [];
        try {
            const fastStartedAt = nowMs();
            const fastResponse = await fetchFuelStations(requestBounds, {
                signal: requestController.signal,
                detail: 'fast',
            });
            fastStations = normalizeFuelStations(fastResponse.data);
            setMapDiagnosticDetail('lastFuelFastMs', Math.round(nowMs() - fastStartedAt));
            setMapDiagnosticDetail('lastFuelFastCount', fastStations.length);
        } catch (error) {
            if (error?.name === 'AbortError') throw error;
            if (isRateLimitError(error)) throw error;
        }

        if (requestId !== fuelStationsRequestId || !isFuelLayerEnabled) return;
        if (fastStations.length > 0) {
            renderFuelStations(fastStations);
            updateFuelLayerMenuState('refreshing', fastStations.length);
        }

        const fullStartedAt = nowMs();
        const response = await fetchFuelStations(requestBounds, {
            signal: requestController.signal,
            detail: 'full',
        });
        if (requestId !== fuelStationsRequestId || !isFuelLayerEnabled) return;

        const stations = normalizeFuelStations(response.data);
        const finalStations = stations.length > 0 ? stations : fastStations;
        const fullMs = Math.round(nowMs() - fullStartedAt);
        const totalMs = Math.round(nowMs() - fuelRequestStartedAt);
        setMapDiagnosticDetail('lastFuelFullMs', fullMs);
        setMapDiagnosticDetail('lastFuelTotalMs', totalMs);
        setMapDiagnosticDetail('lastFuelFullCount', stations.length);
        setMapDiagnosticDetail('lastFuelMeta', response.meta || null);
        if (totalMs > FUEL_STATION_SLOW_REQUEST_MS) {
            sendMapDiagnostics('fuel_request_slow', {
                fuelFullMs: fullMs,
                fuelTotalMs: totalMs,
                fuelFinalCount: finalStations.length,
            });
        }
        cacheFuelStations(cacheKey, finalStations);
        renderFuelStations(finalStations);
        updateFuelLayerMenuState(finalStations.length ? 'ready' : 'empty', finalStations.length);
    } catch (error) {
        if (requestId !== fuelStationsRequestId || !isFuelLayerEnabled) return;
        if (error?.name === 'AbortError' && requestController.signal.reason !== 'timeout') return;
        incrementMapDiagnosticCounter('fuelErrors');

        if (isRateLimitError(error)) {
            fuelStationsRateLimitedUntil = Date.now() + getFuelStationsRateLimitDelay(error);
        }

        sendMapDiagnostics('fuel_request_failed', {
            message: String(error?.message || error),
            status: error?.status || null,
            reason: requestController.signal.reason || null,
            fuelTotalMs: Math.round(nowMs() - fuelRequestStartedAt),
        });

        updateFuelLayerMenuState(renderedFuelStationIds.size ? 'stale' : 'error', renderedFuelStationIds.size);
        window.clearTimeout(fuelStationsRetryTimer);
        fuelStationsRetryTimer = window.setTimeout(
            () => scheduleFuelStationsLoad(0),
            isRateLimitError(error)
                ? getFuelStationsRateLimitDelay(error)
                : (renderedFuelStationIds.size ? 60000 : 10000),
        );
    } finally {
        window.clearTimeout(requestTimeout);
        if (requestId === fuelStationsRequestId) {
            fuelStationsAbortController = null;
        }
    }
}

function getRoundedFuelStationBounds(bounds) {
    const precision = 100;

    return {
        west: Math.floor(bounds.getWest() * precision) / precision,
        south: Math.floor(bounds.getSouth() * precision) / precision,
        east: Math.ceil(bounds.getEast() * precision) / precision,
        north: Math.ceil(bounds.getNorth() * precision) / precision,
    };
}

function isRateLimitError(error) {
    return Number(error?.status) === 429;
}

function getFuelStationsRateLimitDelay(error) {
    const retryAfterMs = Number(error?.retryAfter) > 0 ? Number(error.retryAfter) * 1000 : 0;

    return Math.max(5000, retryAfterMs || FUEL_STATION_RATE_LIMIT_FALLBACK_MS);
}

function getSavedBaseMapLayer() {
    const savedLayer = window.localStorage?.getItem(BASE_LAYER_STORAGE_KEY);

    return normalizeMapLayerId(savedLayer);
}

function setBaseMapLayer(layerId = DEFAULT_BASE_LAYER_ID, { persist = false } = {}) {
    const nextLayerId = normalizeMapLayerId(layerId);

    MAP_LAYER_IDS.forEach((id) => {
        const mapLayerId = `basemap-${id}`;

        if (map?.getLayer(mapLayerId)) {
            try {
                map.setLayoutProperty(mapLayerId, 'visibility', id === nextLayerId ? 'visible' : 'none');
            } catch {}
        }
    });
    updateVectorRoadLayerTheme(nextLayerId);

    applyMapUiTheme(nextLayerId);
    if (persist) {
        window.localStorage?.setItem(BASE_LAYER_STORAGE_KEY, nextLayerId);
    }

    document.querySelectorAll('[data-map-layer]').forEach((button) => {
        button.classList.toggle('is-active', button.dataset.mapLayer === nextLayerId);
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
            'text-color': isDark ? '#EEF6FF' : '#243247',
            'text-halo-color': isDark ? 'rgba(8, 13, 24, 0.86)' : 'rgba(246, 250, 255, 0.92)',
            'text-opacity': isSatellite ? 0 : 0.96,
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
        const nextValue = !isTrafficLayerEnabled();

        window.localStorage?.setItem(TRAFFIC_LAYER_STORAGE_KEY, nextValue ? '1' : '0');
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
    button.dataset.state = isEnabled ? 'on' : 'off';
    button.setAttribute('aria-pressed', String(isEnabled));
    button.setAttribute('aria-label', isEnabled ? 'Выключить пробки' : 'Включить пробки');
    const stateLabel = button.querySelector('[data-traffic-state]');
    if (stateLabel) stateLabel.textContent = isEnabled ? 'Вкл' : 'Выкл';
}

function setTrafficLayerVisibility(isVisible) {
    if (!map?.getLayer(TRAFFIC_FLOW_LAYER_ID)) {
        updateTrafficToggleButton(isVisible);
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
                <button class="map-settings__option" type="button" data-user-location-icon="${option.id}" aria-label="${option.label}">
                    <span class="map-settings__preview">${renderUserLocationIconPreview(option)}</span>
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
        addUserLocationIconImage(option)
    )));
}

function renderUserLocationIconPreview(option) {
    if (option.image) {
        return `<img src="${option.image}" alt="" loading="lazy" decoding="async">`;
    }

    return option.svg();
}

function addUserLocationIconImage(option) {
    const imageName = getUserLocationIconImage(option.id);

    if (option.image) {
        return addRasterImage(imageName, option.image, { size: 120 }).catch(() => (
            addSvgImage(imageName, createUserLocationSvg(), { width: 64, height: 64 })
        ));
    }

    return addSvgImage(imageName, option.svg(), { width: 64, height: 64 });
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
const pendingRasterImages = new Map();

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

function addRasterImage(name, src, { size = 96 } = {}) {
    if (map.hasImage(name)) {
        return Promise.resolve();
    }

    if (pendingRasterImages.has(name)) {
        return pendingRasterImages.get(name);
    }

    const promise = new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => {
            try {
                if (!map?.hasImage(name)) {
                    map?.addImage(name, createTransparentCursorImage(image, size), { pixelRatio: 2 });
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
        image.src = src;
    });

    pendingRasterImages.set(
        name,
        promise.finally(() => {
            pendingRasterImages.delete(name);
        })
    );

    return pendingRasterImages.get(name);
}

function createTransparentCursorImage(image, size) {
    const naturalWidth = image.naturalWidth || image.width;
    const naturalHeight = image.naturalHeight || image.height;
    const sourceScale = Math.min(1, 280 / Math.max(naturalWidth, naturalHeight));
    const sourceCanvas = document.createElement('canvas');
    sourceCanvas.width = Math.max(1, Math.round(naturalWidth * sourceScale));
    sourceCanvas.height = Math.max(1, Math.round(naturalHeight * sourceScale));

    const sourceContext = sourceCanvas.getContext('2d', { willReadFrequently: true });
    sourceContext.drawImage(image, 0, 0, sourceCanvas.width, sourceCanvas.height);

    const sourceImage = sourceContext.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
    const crop = getVisibleImageBounds(sourceImage);
    const outputCanvas = document.createElement('canvas');
    outputCanvas.width = size;
    outputCanvas.height = size;

    const outputContext = outputCanvas.getContext('2d');
    const padding = Math.round(size * 0.08);
    const available = size - padding * 2;
    const scale = Math.min(available / crop.width, available / crop.height);
    const width = crop.width * scale;
    const height = crop.height * scale;
    const x = (size - width) / 2;
    const y = (size - height) / 2;

    outputContext.clearRect(0, 0, size, size);
    outputContext.filter = 'drop-shadow(0 9px 5px rgba(2, 6, 23, 0.42))';
    outputContext.drawImage(sourceCanvas, crop.x, crop.y, crop.width, crop.height, x, y, width, height);

    return outputContext.getImageData(0, 0, size, size);
}

function getVisibleImageBounds(imageData) {
    const pixels = imageData.data;
    let minX = imageData.width;
    let minY = imageData.height;
    let maxX = 0;
    let maxY = 0;

    for (let y = 0; y < imageData.height; y += 1) {
        for (let x = 0; x < imageData.width; x += 1) {
            if (pixels[(y * imageData.width + x) * 4 + 3] <= 12) {
                continue;
            }

            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x);
            maxY = Math.max(maxY, y);
        }
    }

    if (maxX <= minX || maxY <= minY) {
        return { x: 0, y: 0, width: imageData.width, height: imageData.height };
    }

    const inset = Math.max(4, Math.round(Math.min(imageData.width, imageData.height) * 0.02));

    const x = Math.max(0, minX - inset);
    const y = Math.max(0, minY - inset);

    return {
        x,
        y,
        width: Math.min(imageData.width - x, maxX - minX + 1 + inset * 2),
        height: Math.min(imageData.height - y, maxY - minY + 1 + inset * 2),
    };
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

function getSelectedUserLocationIcon() {
    const saved = window.localStorage?.getItem(USER_LOCATION_ICON_STORAGE_KEY);

    return USER_LOCATION_ICON_OPTIONS.some((option) => option.id === saved) ? saved : DEFAULT_USER_LOCATION_ICON_ID;
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
    map.on('rotate', refreshRenderedUserLocationFeature);
    map.on('pitch', () => map?.triggerRepaint());
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
        filter: [
            'all',
            ['!=', ['get', 'mode'], 'navigation'],
            ['!', ['boolean', ['get', 'uses3dModel'], false]],
        ],
        layout: {
            'icon-image': ['get', 'iconImage'],
            'icon-size': ['interpolate', ['linear'], ['zoom'], 12, 0.78, 16, 0.98, 18, 1.12],
            'icon-rotate': 0,
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
        filter: [
            'all',
            ['==', ['get', 'mode'], 'navigation'],
            ['!', ['boolean', ['get', 'uses3dModel'], false]],
        ],
        layout: {
            'icon-image': ['get', 'iconImage'],
            'icon-size': ['interpolate', ['linear'], ['zoom'], 12, 0.82, 16, 0.98, 18, 1.08],
            'icon-rotate': ['coalesce', ['to-number', ['get', 'fallbackHeading']], 0],
            'icon-pitch-alignment': 'viewport',
            'icon-rotation-alignment': 'map',
            'icon-allow-overlap': true,
            'icon-ignore-placement': true,
        },
    });
}

function addUserLocationModelLayer() {
    if (!map) {
        return;
    }

    addUserLocationExtrusionModelLayers();

    if (map.getLayer(USER_LOCATION_MODEL_LAYER_ID)) {
        ensureUserLocationModelLayerOnTop();
        return;
    }

    userLocationModelLayer = createUserLocationModelLayer();
    map.addLayer(userLocationModelLayer);
    ensureUserLocationModelLayerOnTop();
}

function addUserLocationExtrusionModelLayers() {
    if (!map?.getSource(USER_LOCATION_MODEL_SOURCE_ID)) {
        map.addSource(USER_LOCATION_MODEL_SOURCE_ID, {
            type: 'geojson',
            data: buildFeatureCollection([]),
        });
    }

    if (!map.getLayer('user-location-3d-shadow')) {
        map.addLayer({
            id: 'user-location-3d-shadow',
            type: 'fill',
            source: USER_LOCATION_MODEL_SOURCE_ID,
            filter: ['==', ['get', 'part'], 'shadow'],
            paint: {
                'fill-color': 'rgba(0, 0, 0, 0.34)',
                'fill-opacity': 0.42,
            },
        });
    }

    [
        ['user-location-3d-body-fill', ['match', ['get', 'part'], ['body', 'hood', 'trunk', 'trim', 'cabin', 'roof'], true, false], 0.98],
        ['user-location-3d-detail-fill', ['match', ['get', 'part'], ['glass', 'wheel', 'headlight', 'tail', 'running-light'], true, false], 0.94],
        ['user-location-3d-gloss-fill', ['==', ['get', 'part'], 'highlight'], 0.72],
    ].forEach(([id, filter, opacity]) => {
        if (map.getLayer(id)) {
            return;
        }

        map.addLayer({
            id,
            type: 'fill',
            source: USER_LOCATION_MODEL_SOURCE_ID,
            filter,
            paint: {
                'fill-color': ['get', 'color'],
                'fill-opacity': opacity,
            },
        });
    });

    [
        ['user-location-3d-body', ['match', ['get', 'part'], ['body', 'hood', 'trunk', 'trim'], true, false]],
        ['user-location-3d-cabin', ['match', ['get', 'part'], ['cabin', 'roof', 'wheel'], true, false]],
        ['user-location-3d-glass', ['==', ['get', 'part'], 'glass']],
        ['user-location-3d-lights', ['match', ['get', 'part'], ['headlight', 'tail', 'running-light', 'highlight'], true, false]],
    ].forEach(([id, filter]) => {
        if (map.getLayer(id)) {
            return;
        }

        try {
            map.addLayer({
                id,
                type: 'fill-extrusion',
                source: USER_LOCATION_MODEL_SOURCE_ID,
                filter,
                paint: {
                    'fill-extrusion-color': ['get', 'color'],
                    'fill-extrusion-base': ['to-number', ['get', 'base'], 0],
                    'fill-extrusion-height': ['to-number', ['get', 'height'], 0],
                    'fill-extrusion-opacity': 0.98,
                    'fill-extrusion-vertical-gradient': true,
                },
            });
        } catch (error) {
            console.warn('Failed to add 3D user location layer', id, error);
        }
    });
}

function ensureUserLocationModelLayerOnTop() {
    if (!map) {
        return;
    }

    USER_LOCATION_MODEL_EXTRUSION_LAYERS.forEach((layerId) => {
        if (!map.getLayer(layerId)) {
            return;
        }

        try {
            map.moveLayer(layerId);
        } catch {}
    });

    if (!map.getLayer(USER_LOCATION_MODEL_LAYER_ID)) {
        return;
    }

    try {
        map.moveLayer(USER_LOCATION_MODEL_LAYER_ID);
    } catch {}
}

function createUserLocationModelLayer() {
    return {
        id: USER_LOCATION_MODEL_LAYER_ID,
        type: 'custom',
        renderingMode: '3d',
        camera: null,
        scene: null,
        renderer: null,
        model: null,
        fallbackModel: null,
        assetModel: null,
        gltfLoader: null,
        layerMap: null,
        activeIconId: null,
        assetIconId: null,
        loadingIconId: null,
        renderFailed: false,
        onAdd(layerMap, gl) {
            try {
                this.layerMap = layerMap;
                this.camera = new Camera();
                this.scene = new Scene();
                this.gltfLoader = new GLTFLoader();
                this.model = new Group();
                this.fallbackModel = createNavigationVehicleModel({
                    iconOptions: USER_LOCATION_ICON_OPTIONS,
                    defaultIconId: DEFAULT_USER_LOCATION_ICON_ID,
                    modelLengthMeters: USER_LOCATION_MODEL_LENGTH_METERS,
                });
                this.model.add(this.fallbackModel);
                this.scene.add(this.model);
                this.scene.add(new HemisphereLight(0xffffff, 0x27364d, 2.35));

                const keyLight = new DirectionalLight(0xffffff, 3.35);
                keyLight.position.set(-3, -4, 8);
                this.scene.add(keyLight);

                const rimLight = new DirectionalLight(0x8bdcff, 1.55);
                rimLight.position.set(4, 2, 5);
                this.scene.add(rimLight);

                this.renderer = new WebGLRenderer({
                    canvas: layerMap.getCanvas(),
                    context: gl,
                    antialias: true,
                });
                this.renderer.autoClear = false;
                isUserLocationModelLayerReady = true;
                if (renderedUserLocation) {
                    renderUserLocationFeature(renderedUserLocation);
                }
            } catch (error) {
                this.renderFailed = true;
                isUserLocationModelLayerReady = false;
                isUserLocationModelLayerVisible = false;
                refreshRenderedUserLocationFeature();
                console.warn('3D GPS cursor renderer disabled.', error);
            }
        },
        render(gl, options = {}) {
            if (this.renderFailed) {
                return;
            }

            try {
                const location = renderedUserLocation || targetUserLocation;
                const matrix = options.defaultProjectionData?.mainMatrix
                    || options.defaultProjectionData?.projectionMatrix
                    || options.modelViewProjectionMatrix;

                if (!this.renderer || !this.camera || !this.model || !matrix || !isRenderableUserLocationModel(location)) {
                    return;
                }

                const selectedIcon = getSelectedUserLocationIcon();
                if (this.activeIconId !== selectedIcon) {
                    this.setActiveVehicleIcon(selectedIcon);
                    this.activeIconId = selectedIcon;
                }

                if (!this.hasRenderableAssetModel(selectedIcon)) {
                    if (isUserLocationModelLayerVisible) {
                        isUserLocationModelLayerVisible = false;
                        refreshRenderedUserLocationFeature();
                    }
                    return;
                }

                syncUserLocationModelRenderer(this.renderer, this.layerMap);

                const coordinate = maplibregl.MercatorCoordinate.fromLngLat(
                    getUserLocationRenderCoordinate(location),
                    USER_LOCATION_MODEL_ALTITUDE_METERS,
                );
                const scale = coordinate.meterInMercatorCoordinateUnits() * USER_LOCATION_MODEL_VISUAL_SCALE;
                const heading = getUserLocationModelHeading(location);
                const worldMatrix = new Matrix4()
                    .makeTranslation(coordinate.x, coordinate.y, coordinate.z)
                    .scale(new Vector3(scale, -scale, scale * USER_LOCATION_MODEL_VERTICAL_SCALE))
                    .multiply(new Matrix4().makeRotationZ(degreesToRadians(heading + 180)));

                this.camera.projectionMatrix = new Matrix4()
                    .fromArray(matrix)
                    .multiply(worldMatrix);
                this.renderer.resetState();
                this.renderer.clearDepth();
                this.renderer.render(this.scene, this.camera);
                markUserLocationModelVisible();
            } catch (error) {
                this.renderFailed = true;
                isUserLocationModelLayerReady = false;
                isUserLocationModelLayerVisible = false;
                refreshRenderedUserLocationFeature();
                console.warn('3D GPS cursor render failed.', error);
            }
        },
        hasRenderableAssetModel(iconId) {
            return Boolean(
                iconId !== DEFAULT_USER_LOCATION_ICON_ID
                && this.assetModel
                && this.assetIconId === iconId
                && this.assetModel.visible !== false
            );
        },
        setActiveVehicleIcon(iconId) {
            isUserLocationModelLayerVisible = false;
            applyNavigationVehicleStyle(this.fallbackModel, iconId);

            if (iconId === DEFAULT_USER_LOCATION_ICON_ID) {
                this.clearAssetModel();
                if (this.fallbackModel) this.fallbackModel.visible = false;
                return;
            }

            if (this.fallbackModel) this.fallbackModel.visible = false;
            this.loadAssetModel(iconId);
        },
        loadAssetModel(iconId) {
            const url = USER_LOCATION_GLB_MODELS[iconId];

            if (!url || !this.gltfLoader || this.loadingIconId === iconId || this.assetIconId === iconId) {
                return;
            }

            this.loadingIconId = iconId;

            const cached = userLocationGltfModelCache.get(iconId);
            if (cached) {
                this.useAssetModel(iconId, cloneNavigationGltfModel(cached));
                this.loadingIconId = null;
                return;
            }

            this.gltfLoader.load(
                url,
                (gltf) => {
                    const prepared = prepareNavigationGltfModel(gltf.scene, iconId);
                    userLocationGltfModelCache.set(iconId, prepared);

                    if (this.activeIconId === iconId) {
                        this.useAssetModel(iconId, cloneNavigationGltfModel(prepared));
                        refreshRenderedUserLocationFeature();
                    }

                    this.loadingIconId = null;
                    map?.triggerRepaint();
                },
                undefined,
                (error) => {
                    this.loadingIconId = null;
                    if (this.fallbackModel) this.fallbackModel.visible = false;
                    refreshRenderedUserLocationFeature();
                    console.warn('Failed to load GLB GPS cursor model.', iconId, error);
                },
            );
        },
        useAssetModel(iconId, assetModel) {
            this.clearAssetModel();
            this.assetModel = assetModel;
            this.assetIconId = iconId;
            if (this.fallbackModel) this.fallbackModel.visible = false;
            this.model?.add(assetModel);
        },
        clearAssetModel() {
            if (!this.assetModel) {
                this.assetIconId = null;
                return;
            }

            this.model?.remove(this.assetModel);
            this.assetModel = null;
            this.assetIconId = null;
        },
        onRemove() {
            this.scene?.traverse((object) => {
                object.geometry?.dispose?.();
                if (Array.isArray(object.material)) {
                    object.material.forEach((material) => material.dispose?.());
                } else {
                    object.material?.dispose?.();
                }
            });
            this.renderer?.dispose?.();
            this.renderer = null;
            this.scene = null;
            this.camera = null;
            this.model = null;
            this.layerMap = null;
            isUserLocationModelLayerReady = false;
            isUserLocationModelLayerVisible = false;
        },
    };
}

function cloneNavigationGltfModel(source) {
    const clone = source.clone(true);

    clone.traverse((object) => {
        if (!object.isMesh) {
            return;
        }

        if (Array.isArray(object.material)) {
            object.material = object.material.map((material) => material.clone());
        } else if (object.material) {
            object.material = object.material.clone();
        }
    });

    return clone;
}

function prepareNavigationGltfModel(scene, iconId) {
    const wrapper = new Group();
    const model = scene.clone(true);

    model.rotation.x = Math.PI / 2;
    model.updateMatrixWorld(true);

    const box = new Box3().setFromObject(model);
    const size = new Vector3();
    const center = new Vector3();
    box.getSize(size);
    box.getCenter(center);

    const longestAxis = Math.max(size.x, size.y, size.z, Number.EPSILON);
    const scale = USER_LOCATION_GLB_MODEL_LENGTH_METERS / longestAxis;
    model.scale.setScalar(scale);
    model.position.set(-center.x * scale, -center.y * scale, -box.min.z * scale);

    applyNavigationGltfMaterials(model, iconId);
    wrapper.add(model);

    return wrapper;
}

function applyNavigationGltfMaterials(model, iconId) {
    const palette = getUserLocationVehicleExtrusionColors(iconId);

    model.traverse((object) => {
        if (!object.isMesh || !object.material) {
            return;
        }

        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach((material) => {
            const color = material.color instanceof Color ? material.color : new Color('#ffffff');
            const luminance = (color.r * 0.2126) + (color.g * 0.7152) + (color.b * 0.0722);
            const name = `${object.name || ''} ${material.name || ''}`.toLowerCase();

            if (name.includes('toycar')) {
                material.color = new Color(palette.body);
                material.roughness = 0.12;
                material.metalness = 0.64;
                material.flatShading = false;
                material.emissive = new Color(palette.body).multiplyScalar(0.035);
                material.emissiveIntensity = 0.35;
                if ('clearcoat' in material) material.clearcoat = 0.82;
                if ('clearcoatRoughness' in material) material.clearcoatRoughness = 0.08;
                return;
            }

            if (name.includes('fabric')) {
                material.color = new Color('#05070d');
                material.roughness = 0.42;
                material.metalness = 0.24;
                material.flatShading = false;
                return;
            }

            material.roughness = name.includes('glass') || name.includes('window') ? 0.05 : 0.16;
            material.metalness = luminance < 0.14 ? 0.28 : 0.72;
            material.flatShading = false;

            if (name.includes('glass') || name.includes('window') || (color.b > color.r * 1.15 && color.b > color.g * 0.85)) {
                material.color = new Color(palette.glass);
                material.transparent = true;
                material.opacity = 0.72;
                material.metalness = 0.42;
                material.roughness = 0.04;
                if ('transmission' in material) material.transmission = 0.42;
                return;
            }

            if (luminance < 0.10) {
                material.color = new Color('#05070d');
                material.roughness = 0.34;
                material.metalness = 0.24;
                return;
            }

            if (color.r > 0.72 && color.g < 0.26 && color.b < 0.30) {
                material.color = new Color(palette.tailLight);
                material.emissive = new Color(palette.tailLight);
                material.emissiveIntensity = 0.82;
                return;
            }

            if (luminance > 0.82) {
                material.color = new Color(palette.headlight);
                material.emissive = new Color('#9df4ff');
                material.emissiveIntensity = 0.54;
                return;
            }

            material.color = new Color(palette.body);
            material.emissive = new Color(palette.body).multiplyScalar(0.05);
        });
    });
}

function markUserLocationModelVisible() {
    if (isUserLocationModelLayerVisible) {
        return;
    }

    isUserLocationModelLayerVisible = true;
    refreshRenderedUserLocationFeature();
}

function getUserLocationModelHeading(location) {
    const routeBearing = Number(location?.routeBearing);
    const heading = Number.isFinite(routeBearing) && location?.headingMode === 'navigation'
        ? routeBearing
        : Number(location?.heading);

    if (!Number.isFinite(heading)) {
        return 0;
    }

    return normalizeDegrees(heading);
}

function getUserLocationRenderCoordinate(location) {
    const progress = Number(location?.routeProgressMeters);
    const routeCoordinate = location?.headingMode === 'navigation' && Number.isFinite(progress)
        ? getRouteCoordinateAtProgress(activeNavigationRouteCoordinates, progress)
        : null;

    if (routeCoordinate) {
        return routeCoordinate;
    }

    return [Number(location.longitude), Number(location.latitude)];
}

function syncUserLocationModelRenderer(renderer, layerMap) {
    const canvas = layerMap?.getCanvas?.();

    if (!canvas) {
        return;
    }

    renderer.setSize(canvas.width, canvas.height, false);
}

function isRenderableUserLocationModel(location) {
    return Boolean(
        location
            && Number.isFinite(Number(location.latitude))
            && Number.isFinite(Number(location.longitude))
    );
}

function degreesToRadians(value) {
    return (Number(value) || 0) * Math.PI / 180;
}

function normalizeDegrees(value) {
    return ((Number(value) % 360) + 360) % 360;
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
    window.addEventListener('fuel-station:route-opened', () => closeFuelStationPopup({ restoreCamera: false }));

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
        if (isFuelLayerEnabled && !isFuelPopupCameraTransitionActive()) {
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
    const isSheetMode = isFuelPopupSheetMode();
    const stationId = String(properties.stationId || '');
    let prices = {};
    try {
        prices = JSON.parse(properties.pricesJson || '{}');
    } catch {}
    let availableFuelTypes = [];
    try {
        const parsedFuelTypes = JSON.parse(properties.availableFuelTypesJson || '[]');
        availableFuelTypes = Array.isArray(parsedFuelTypes) ? parsedFuelTypes.filter(Boolean) : [];
    } catch {}

    const priceRows = Object.entries(prices)
        .map(([fuel, price]) => `
            <div class="fuel-popup__price">
                <span>${escapeMapHtml(fuel)}</span>
                <strong>${escapeMapHtml(price)}</strong>
            </div>
        `)
        .join('');
    const hasPrices = priceRows !== '';
    const availabilityRows = availableFuelTypes
        .map((fuel) => `<span>${escapeMapHtml(fuel)}</span>`)
        .join('');
    const hasTbankAvailability = availabilityRows !== '' && properties.fuelAvailabilitySource;
    const updatedAt = hasPrices ? formatFuelUpdatedAt(properties.updatedAt) : '';
    const stationName = properties.name || properties.brand || 'АЗС';
    const stationAddress = String(properties.address || '').trim();
    const normalizedAddress = stationAddress.toLocaleLowerCase('ru-RU');
    const normalizedName = String(stationName).trim().toLocaleLowerCase('ru-RU');
    const showAddress = stationAddress !== '' && normalizedAddress !== normalizedName;
    const noPriceMessage = getFuelPriceUnavailableMessage(properties.brand || properties.name);
    const previousFuelPopupCameraSnapshot = isSheetMode ? fuelPopupCameraSnapshot : null;

    closeFuelStationPopup({ restoreCamera: false });
    const sourceLink = hasPrices && isSafeHttpUrl(properties.osmUrl)
        ? `<a href="${escapeMapAttribute(properties.osmUrl)}" target="_blank" rel="noreferrer">Открыть источник</a>`
        : '';
    if (isSheetMode) {
        fuelPopupCameraSnapshot = previousFuelPopupCameraSnapshot ?? getFuelPopupCameraSnapshot();
    }

    activeFuelStationId = stationId;
    document.body.classList.toggle('is-fuel-popup-open', isSheetMode);
    fuelStationPopup = new maplibregl.Popup({
        closeButton: true,
        closeOnClick: !isSheetMode,
        offset: isSheetMode ? 0 : 30,
        anchor: isSheetMode ? 'bottom' : undefined,
        className: 'fuel-station-popup',
        maxWidth: isSheetMode ? 'none' : '330px',
    })
        .setLngLat(feature.geometry.coordinates)
        .setHTML(`
            <article class="fuel-popup">
                <div class="fuel-popup__head">
                    <span class="fuel-popup__status is-unknown">${escapeMapHtml(stationName)}</span>
                    ${showAddress ? `<p>${escapeMapHtml(stationAddress)}</p>` : ''}
                </div>
                <div class="fuel-popup__prices">
                    ${priceRows || `<p class="fuel-popup__notice">${escapeMapHtml(noPriceMessage)}</p>`}
                </div>
                ${hasTbankAvailability ? `
                    <div class="fuel-popup__availability">
                        <small>Доступно в T-Bank для оплаты</small>
                        <div>${availabilityRows}</div>
                    </div>
                ` : ''}
                ${properties.openingHours ? `<p class="fuel-popup__hours">Режим: ${escapeMapHtml(properties.openingHours)}</p>` : ''}
                ${updatedAt ? `<small>Данные обновлены: ${escapeMapHtml(updatedAt)}</small>` : ''}
                ${hasPrices && properties.priceSource ? `<small>Источник цены: ${escapeMapHtml(properties.priceSource)}</small>` : ''}
                ${hasTbankAvailability ? `<small>Источник доступности: ${escapeMapHtml(properties.fuelAvailabilitySource)}</small>` : ''}
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
        activeFuelStationId = null;
        document.body.classList.remove('is-fuel-popup-open');
        restoreFuelPopupCamera();
    });

    if (isSheetMode) {
        focusFuelStationForSheet(feature.geometry.coordinates);
    }
}

function isFuelPopupSheetMode() {
    return window.matchMedia?.('(max-width: 640px)').matches
        || window.innerWidth <= 640;
}

function focusFuelStationForSheet(coordinates) {
    if (!Array.isArray(coordinates) || coordinates.length < 2) return;

    markFuelPopupCameraTransition(520);
    safeEaseTo({
        center: coordinates,
        zoom: Math.max(map?.getZoom?.() ?? 0, 15.25),
        offset: [0, -Math.min(170, Math.round(window.innerHeight * 0.22))],
        duration: 280,
        essential: true,
    });
}

function getFuelPopupCameraSnapshot() {
    const center = map?.getCenter?.();
    if (!center) return null;

    return {
        center: [center.lng, center.lat],
        zoom: map.getZoom(),
        bearing: map.getBearing(),
        pitch: map.getPitch(),
    };
}

function restoreFuelPopupCamera() {
    const snapshot = fuelPopupCameraSnapshot;
    fuelPopupCameraSnapshot = null;
    if (!snapshot || !isFuelLayerEnabled || !isFuelPopupSheetMode()) return;

    markFuelPopupCameraTransition(620);
    safeEaseTo({
        ...snapshot,
        duration: 260,
        essential: true,
    });

    window.setTimeout(() => {
        if (isFuelLayerEnabled && !fuelStationPopup) {
            scheduleFuelStationsLoad(120);
        }
    }, 680);
}

function markFuelPopupCameraTransition(durationMs) {
    fuelPopupCameraTransitionUntil = Math.max(
        fuelPopupCameraTransitionUntil,
        Date.now() + durationMs,
    );
}

function isFuelPopupCameraTransitionActive() {
    return Date.now() < fuelPopupCameraTransitionUntil;
}

function getFuelPriceUnavailableMessage(brand) {
    const normalizedBrand = String(brand || '').toLocaleLowerCase('ru-RU');

    if (normalizedBrand.includes('лукойл') || normalizedBrand.includes('lukoil')) {
        return 'Официальная карта ЛУКОЙЛ показывает виды топлива, но не публикует цену этой АЗС.';
    }

    return 'Цена этой АЗС не опубликована в доступных источниках.';
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

export function focusUserLocation({
    latitude,
    longitude,
    accuracy = 0,
    heading = 0,
    headingMode = 'compass',
    routeBearing = null,
    routeProgressMeters = null,
    routeDistanceMeters = null,
}, { focus = true } = {}) {
    if (!map) {
        return;
    }

    const mode = headingMode === 'navigation' ? 'navigation' : 'compass';
    const routeCoordinate = mode === 'navigation' && Number.isFinite(Number(routeProgressMeters))
        ? getRouteCoordinateAtProgress(activeNavigationRouteCoordinates, Number(routeProgressMeters))
        : null;
    const nextLocation = {
        latitude: routeCoordinate ? Number(routeCoordinate[1]) : Number(latitude),
        longitude: routeCoordinate ? Number(routeCoordinate[0]) : Number(longitude),
        accuracy: Math.max(Number(accuracy) || 0, 20),
        heading: Number.isFinite(Number(routeBearing)) && mode === 'navigation'
            ? Number(routeBearing)
            : (Number.isFinite(Number(heading)) ? Number(heading) : 0),
        headingMode: mode,
        routeBearing: Number.isFinite(Number(routeBearing)) ? Number(routeBearing) : null,
        routeProgressMeters: Number.isFinite(Number(routeProgressMeters)) ? Number(routeProgressMeters) : null,
        routeDistanceMeters: Number.isFinite(Number(routeDistanceMeters)) ? Number(routeDistanceMeters) : null,
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
    ensureUserLocationModelLayerOnTop();
    const modelVisible = renderUserLocationModelFeature(location);
    map.getSource(USER_LOCATION_SOURCE_ID)?.setData({
        type: 'FeatureCollection',
        features: [{
            type: 'Feature',
            properties: {
                accuracy: location.accuracy,
                heading: location.heading,
                fallbackHeading: getUserLocationFallbackHeading(location),
                routeBearing: location.routeBearing,
                routeProgressMeters: location.routeProgressMeters,
                mode: location.headingMode,
                iconImage: getUserLocationIconImage(),
                uses3dModel: shouldRenderUserLocationWithGltfModel(),
                modelVisible,
            },
            geometry: {
                type: 'Point',
                coordinates: getUserLocationRenderCoordinate(location),
            },
        }],
    });
    if (isUserLocationModelLayerReady) {
        map?.triggerRepaint();
    }
}

function renderUserLocationModelFeature(location) {
    const source = map?.getSource(USER_LOCATION_MODEL_SOURCE_ID);
    const iconId = getSelectedUserLocationIcon();

    if (!source || !isRenderableUserLocationModel(location) || iconId === DEFAULT_USER_LOCATION_ICON_ID) {
        source?.setData?.(buildFeatureCollection([]));
        return false;
    }

    if (isUserLocationGltfModelActive(iconId) || isUserLocationGltfModelLoading(iconId)) {
        source.setData(buildFeatureCollection([]));
        return isUserLocationModelLayerVisible && isUserLocationGltfModelActive(iconId);
    }

    if (!shouldRenderUserLocationExtrusionFallback(iconId)) {
        source.setData(buildFeatureCollection([]));
        return false;
    }

    const coordinate = getUserLocationRenderCoordinate(location);
    const features = buildUserLocationVehicleExtrusions(
        coordinate,
        getUserLocationModelHeading(location),
        iconId,
    );

    source.setData({
        type: 'FeatureCollection',
        features,
    });
    ensureUserLocationModelLayerOnTop();

    return features.length > 0;
}

function isUserLocationGltfModelActive(iconId) {
    return Boolean(
        userLocationModelLayer
        && !userLocationModelLayer.renderFailed
        && userLocationModelLayer.assetIconId === iconId
        && userLocationModelLayer.assetModel
    );
}

function shouldRenderUserLocationWithGltfModel() {
    const iconId = getSelectedUserLocationIcon();

    return Boolean(iconId !== DEFAULT_USER_LOCATION_ICON_ID && USER_LOCATION_GLB_MODELS[iconId]);
}

function isUserLocationGltfModelLoading(iconId) {
    return Boolean(
        userLocationModelLayer
        && !userLocationModelLayer.renderFailed
        && userLocationModelLayer.loadingIconId === iconId
    );
}

function shouldRenderUserLocationExtrusionFallback(iconId) {
    return Boolean(
        iconId !== DEFAULT_USER_LOCATION_ICON_ID
        && userLocationModelLayer
        && userLocationModelLayer.renderFailed
    );
}

function buildUserLocationVehicleExtrusions(center, heading, iconId) {
    if (!Array.isArray(center) || !Number.isFinite(Number(center[0])) || !Number.isFinite(Number(center[1]))) {
        return [];
    }

    const colors = getUserLocationVehicleExtrusionColors(iconId);
    const polygonPart = (name, points, base, height, color, opacity = 1) => ({
        type: 'Feature',
        properties: {
            part: name,
            base,
            height,
            color,
            opacity,
        },
        geometry: {
            type: 'Polygon',
            coordinates: [buildRotatedMeterPolygon(center, heading, points)],
        },
    });
    const part = (name, localCenter, size, base, height, color, opacity = 1) => polygonPart(
        name,
        getRectangleMeterPoints(localCenter, size),
        base,
        height,
        color,
        opacity,
    );
    const body = [
        [-1.18, -4.92],
        [1.18, -4.92],
        [1.72, -4.42],
        [2.08, -2.74],
        [2.18, 1.18],
        [1.78, 3.74],
        [1.20, 4.82],
        [-1.20, 4.82],
        [-1.78, 3.74],
        [-2.18, 1.18],
        [-2.08, -2.74],
        [-1.72, -4.42],
    ];
    const cabin = [
        [-1.06, -2.42],
        [1.06, -2.42],
        [1.36, -1.12],
        [1.22, 1.62],
        [0.78, 2.38],
        [-0.78, 2.38],
        [-1.22, 1.62],
        [-1.36, -1.12],
    ];
    const glass = [
        [-0.82, -2.08],
        [0.82, -2.08],
        [0.98, -0.82],
        [0.84, 1.38],
        [0.54, 1.90],
        [-0.54, 1.90],
        [-0.84, 1.38],
        [-0.98, -0.82],
    ];

    return [
        part('shadow', [0, -0.16], [5.35, 10.82], 0, 0, '#000000', 0.30),
        polygonPart('body', body, 0.12, 1.38, colors.side),
        polygonPart('body', body.map(([x, y]) => [x * 0.91, y * 0.96]), 1.38, 2.26, colors.body),
        polygonPart('hood', [[-1.28, 2.20], [1.28, 2.20], [1.56, 3.54], [0.94, 4.54], [-0.94, 4.54], [-1.56, 3.54]], 2.28, 2.72, colors.lightBody),
        polygonPart('trunk', [[-1.20, -4.44], [1.20, -4.44], [1.44, -3.20], [-1.44, -3.20]], 2.20, 2.62, colors.lightBody),
        part('trim', [-1.88, -0.32], [0.30, 6.92], 0.42, 1.68, colors.darkTrim),
        part('trim', [1.88, -0.32], [0.30, 6.92], 0.42, 1.68, colors.darkTrim),
        part('wheel', [-2.08, -2.92], [0.46, 1.30], 0.22, 1.18, '#070b12', 0.98),
        part('wheel', [2.08, -2.92], [0.46, 1.30], 0.22, 1.18, '#070b12', 0.98),
        part('wheel', [-2.10, 2.76], [0.44, 1.24], 0.22, 1.14, '#070b12', 0.98),
        part('wheel', [2.10, 2.76], [0.44, 1.24], 0.22, 1.14, '#070b12', 0.98),
        polygonPart('cabin', cabin, 2.24, 3.34, colors.roof, 0.98),
        polygonPart('glass', glass, 3.36, 3.74, colors.glass, 0.92),
        part('highlight', [-0.56, 0.36], [0.28, 3.74], 3.78, 3.86, colors.gloss, 0.70),
        part('highlight', [0.74, 1.74], [0.18, 1.82], 3.78, 3.86, colors.gloss, 0.58),
        part('headlight', [-0.72, 4.68], [0.62, 0.32], 1.36, 1.94, colors.headlight, 0.98),
        part('headlight', [0.72, 4.68], [0.62, 0.32], 1.36, 1.94, colors.headlight, 0.98),
        part('running-light', [-1.42, 3.86], [0.20, 0.78], 1.42, 2.08, colors.runningLight, 0.94),
        part('running-light', [1.42, 3.86], [0.20, 0.78], 1.42, 2.08, colors.runningLight, 0.94),
        part('tail', [-0.86, -4.72], [0.72, 0.34], 1.28, 2.08, colors.tailLight, 0.98),
        part('tail', [0.86, -4.72], [0.72, 0.34], 1.28, 2.08, colors.tailLight, 0.98),
    ];
}

function buildRotatedMeterRectangle(center, heading, [x, y], [width, length]) {
    return buildRotatedMeterPolygon(center, heading, getRectangleMeterPoints([x, y], [width, length]));
}

function getRectangleMeterPoints([x, y], [width, length]) {
    return [
        [-width / 2, -length / 2],
        [width / 2, -length / 2],
        [width / 2, length / 2],
        [-width / 2, length / 2],
    ].map(([cornerX, cornerY]) => [x + cornerX, y + cornerY]);
}

function buildRotatedMeterPolygon(center, heading, points) {
    const corners = points.map(([x, y]) => offsetCoordinateByHeading(
        center,
        heading,
        x * USER_LOCATION_EXTRUSION_MODEL_SCALE,
        y * USER_LOCATION_EXTRUSION_MODEL_SCALE,
    ));

    return [...corners, corners[0]];
}

function offsetCoordinateByHeading(center, heading, rightMeters, forwardMeters) {
    const angle = degreesToRadians(heading);
    const eastMeters = (rightMeters * Math.cos(angle)) + (forwardMeters * Math.sin(angle));
    const northMeters = (forwardMeters * Math.cos(angle)) - (rightMeters * Math.sin(angle));
    const latitude = Number(center[1]);
    const longitude = Number(center[0]);
    const metersPerDegreeLatitude = 111320;
    const metersPerDegreeLongitude = Math.max(
        1,
        metersPerDegreeLatitude * Math.cos(degreesToRadians(latitude)),
    );

    return [
        longitude + (eastMeters / metersPerDegreeLongitude),
        latitude + (northMeters / metersPerDegreeLatitude),
    ];
}

function getUserLocationVehicleExtrusionColors(iconId) {
    const body = {
        'auralith-nav-black': '#101827',
        'auralith-nav-red': '#f0193f',
        'auralith-nav-white': '#f4f8ff',
        'auralith-nav-cyan': '#1ad7ff',
        'auralith-nav-graphite': '#3f4654',
    }[iconId] ?? '#1f8cff';
    const side = {
        'auralith-nav-black': '#050814',
        'auralith-nav-red': '#8f1022',
        'auralith-nav-white': '#b9c8db',
        'auralith-nav-cyan': '#057c9a',
        'auralith-nav-graphite': '#171d28',
    }[iconId] ?? '#0f3d82';
    const lightBody = {
        'auralith-nav-black': '#26354b',
        'auralith-nav-red': '#ff345c',
        'auralith-nav-white': '#ffffff',
        'auralith-nav-cyan': '#65efff',
        'auralith-nav-graphite': '#6b7584',
    }[iconId] ?? '#43a5ff';
    const gloss = {
        'auralith-nav-black': '#a8c7ff',
        'auralith-nav-red': '#ffd0da',
        'auralith-nav-white': '#ffffff',
        'auralith-nav-cyan': '#d4fbff',
        'auralith-nav-graphite': '#d8e2f0',
    }[iconId] ?? '#cceeff';

    return {
        body,
        side,
        lightBody,
        darkTrim: side,
        roof: body,
        glass: '#06111f',
        gloss,
        headlight: '#eaffff',
        runningLight: iconId === 'auralith-nav-red' ? '#ff8ca0' : '#9ff7ff',
        tailLight: '#ff164d',
    };
}

function refreshRenderedUserLocationFeature() {
    if (userLocationFeatureRefreshFrame || !renderedUserLocation || !map?.getSource(USER_LOCATION_SOURCE_ID)) {
        return;
    }

    userLocationFeatureRefreshFrame = window.requestAnimationFrame(() => {
        userLocationFeatureRefreshFrame = null;
        if (renderedUserLocation && map?.getSource(USER_LOCATION_SOURCE_ID)) {
            renderUserLocationFeature(renderedUserLocation);
        }
    });
}

function getUserLocationFallbackHeading(location) {
    const routeBearing = Number(location?.routeBearing);
    const heading = Number.isFinite(routeBearing) && location?.headingMode === 'navigation'
        ? routeBearing
        : Number(location?.heading);

    if (!Number.isFinite(heading)) {
        return 0;
    }

    return normalizeDegrees(heading);
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

export async function buildRouteToSpot(userLocation, spot, { camera = 'overview', preferFast = false } = {}) {
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
    const routeRequest = preferFast
        ? Promise.any([
            fetchOfficialTrafficRoute(start, finish),
            wait(650).then(() => fetchOpenStreetMapRoute(start, finish, directDistanceMeters)),
        ])
        : fetchTrafficRoute(start, finish, directDistanceMeters);
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
        USER_LOCATION_MODEL_LAYER_ID,
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
    activeNavigationRouteCoordinates = [];
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

    activeNavigationRouteCoordinates = coordinates;
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

function setRouteTrafficMode() {
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

    activeNavigationRouteCoordinates = routeCoordinates;
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

    activeNavigationRouteCoordinates = coordinates;
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
        return await fetchOfficialTrafficRoute(start, finish);
    } catch {
        // Fall through to public OSRM only when Yandex is unavailable or not configured.
    }

    return fetchOpenStreetMapRoute(start, finish, directDistanceMeters);
}

async function fetchOfficialTrafficRoute(start, finish) {
    const route = await fetchYandexDrivingRoute(start, finish);

    if (!route?.geometry?.coordinates?.length) {
        throw new Error('Traffic route service returned an empty route.');
    }

    return route;
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
    map?.getSource(FUEL_STATION_SOURCE_ID)?.setData(buildFuelStationFeatureCollection(normalized));
}

function getFuelStationId(station) {
    const longitude = Number(station?.longitude);
    const latitude = Number(station?.latitude);

    return String(station?.id ?? `${longitude.toFixed(5)}:${latitude.toFixed(5)}`);
}

function getFuelStationsCacheKey(bounds) {
    return [
        bounds.west,
        bounds.south,
        bounds.east,
        bounds.north,
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
                        availableFuelTypesJson: JSON.stringify(station.availableFuelTypes || []),
                        openingHours: station.openingHours || '',
                        updatedAt: station.updatedAt || '',
                        osmUrl: station.osmUrl || '',
                        priceSource: station.priceSource || '',
                        fuelAvailabilitySource: station.fuelAvailabilitySource || '',
                        fuelAvailabilityUpdatedAt: station.fuelAvailabilityUpdatedAt || '',
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

function closeFuelStationPopup({ restoreCamera = true } = {}) {
    if (!restoreCamera) {
        fuelPopupCameraSnapshot = null;
    }

    fuelStationPopup?.remove();
    fuelStationPopup = null;
    activeFuelStationId = null;
    document.body.classList.remove('is-fuel-popup-open');

    if (restoreCamera) {
        restoreFuelPopupCamera();
    }
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

