import maplibregl from 'maplibre-gl';
import { fetchDrivingRoute as fetchYandexDrivingRoute, fetchParkingSpots, reverseGeocode } from './parking-api';
import { getClosestRouteProjection, isManualMapInteraction } from './navigation-logic';

let map = null;
let spotsCache = [];
let pendingMarker = null;
let addressRequestId = 0;
let userLocationRenderFrame = null;
let renderedUserLocation = null;
let targetUserLocation = null;
let isPickingMode = false;
let isTrafficSuppressedByRoute = false;
let isTrafficForcedVisibleByUser = false;
let routeManeuverMarker = null;
let routeManeuverCoordinate = null;

const MOSCOW_CENTER = [37.6173, 55.7558];
const MAP_CONTAINER_ID = 'parking-map';
const SOURCE_ID = 'parking-spots';
const PENDING_SOURCE_ID = 'pending-parking-spot';
const USER_LOCATION_SOURCE_ID = 'user-location';
const ROUTE_SOURCE_ID = 'active-route';
const SPEED_CAMERA_SOURCE_ID = 'speed-cameras';
const TRAFFIC_FLOW_SOURCE_ID = 'tomtom-traffic-flow';
const TRAFFIC_FLOW_LAYER_ID = 'tomtom-traffic-flow';
const ROUTE_CASING_LAYER_ID = 'active-route-casing';
const ROUTE_LINE_LAYER_ID = 'active-route-line';
const ROAD_SOURCE_ID = 'openfreemap-vector';
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
const USER_LOCATION_ICON_STORAGE_KEY = 'auralith:user-location-icon';
const USER_LOCATION_ICON_PREFIX = 'user-location-';
const FOLLOW_ZOOM = 17.75;
const FOLLOW_PITCH = 68;
const FOLLOW_SCREEN_OFFSET_RATIO = 0.24;
const FOLLOW_CENTER_LOOKAHEAD_METERS = 12;
const FOLLOW_BEARING_LOOKAHEAD_METERS = 45;
const ROUTE_TRAFFIC_LINE_COLOR = [
    'match',
    ['get', 'traffic'],
    'jam',
    '#EF174A',
    'heavy',
    '#FF7A1A',
    'slow',
    '#FFD84D',
    'free',
    '#22C55E',
    '#20F4FF',
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
                'background-color': '#EEF4F1',
            },
        },
        {
            id: 'water-fill',
            type: 'fill',
            source: ROAD_SOURCE_ID,
            'source-layer': 'water',
            paint: {
                'fill-color': '#B9E4F2',
                'fill-opacity': 1,
            },
        },
        {
            id: 'park-fill',
            type: 'fill',
            source: ROAD_SOURCE_ID,
            'source-layer': 'park',
            paint: {
                'fill-color': '#CFE9CE',
                'fill-opacity': 0.78,
            },
        },
        {
            id: 'landuse-fill',
            type: 'fill',
            source: ROAD_SOURCE_ID,
            'source-layer': 'landuse',
            minzoom: 10,
            paint: {
                'fill-color': '#E2EBDF',
                'fill-opacity': 0.48,
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
            id: 'building-3d',
            type: 'fill-extrusion',
            source: ROAD_SOURCE_ID,
            'source-layer': 'building',
            minzoom: 14,
            paint: {
                'fill-extrusion-color': 'rgba(70, 86, 104, 0.58)',
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
                'fill-extrusion-opacity': 0.82,
                'fill-extrusion-vertical-gradient': true,
            },
        },
        {
            id: 'road-casing-minor',
            type: 'line',
            source: ROAD_SOURCE_ID,
            'source-layer': 'transportation',
            minzoom: 11,
            filter: ['in', ['get', 'class'], ['literal', ['minor', 'service', 'track', 'path']]],
            layout: {
                'line-cap': 'round',
                'line-join': 'round',
            },
            paint: {
                'line-color': 'rgba(15, 23, 42, 0.32)',
                'line-width': ['interpolate', ['linear'], ['zoom'], 11, 1.4, 15, 5, 18, 12],
                'line-opacity': 0.72,
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
                'line-color': 'rgba(2, 6, 23, 0.42)',
                'line-width': ['interpolate', ['linear'], ['zoom'], 8, 2, 13, 7, 17, 22],
                'line-opacity': 0.82,
            },
        },
        {
            id: 'road-minor',
            type: 'line',
            source: ROAD_SOURCE_ID,
            'source-layer': 'transportation',
            minzoom: 11,
            filter: ['in', ['get', 'class'], ['literal', ['minor', 'service', 'track', 'path']]],
            layout: {
                'line-cap': 'round',
                'line-join': 'round',
            },
            paint: {
                'line-color': '#FFFFFF',
                'line-width': ['interpolate', ['linear'], ['zoom'], 11, 0.8, 15, 3.8, 18, 9],
                'line-opacity': 0.94,
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
                'line-color': '#FFF8DF',
                'line-width': ['interpolate', ['linear'], ['zoom'], 8, 1.2, 13, 5, 17, 17],
                'line-opacity': 0.96,
            },
        },
        {
            id: 'road-lane-major',
            type: 'line',
            source: ROAD_SOURCE_ID,
            'source-layer': 'transportation',
            minzoom: 14,
            filter: ['in', ['get', 'class'], ['literal', ['motorway', 'trunk', 'primary', 'secondary', 'tertiary']]],
            layout: {
                'line-cap': 'butt',
                'line-join': 'round',
            },
            paint: {
                'line-color': 'rgba(71, 85, 105, 0.42)',
                'line-width': ['interpolate', ['linear'], ['zoom'], 14, 0, 15, 0.8, 17, 1.2, 19, 1.6],
                'line-dasharray': [1.1, 1.25],
                'line-opacity': ['interpolate', ['linear'], ['zoom'], 14, 0, 15, 0.38, 17, 0.62],
            },
        },
        {
            id: 'road-lane-minor',
            type: 'line',
            source: ROAD_SOURCE_ID,
            'source-layer': 'transportation',
            minzoom: 16,
            filter: ['in', ['get', 'class'], ['literal', ['minor', 'service']]],
            layout: {
                'line-cap': 'butt',
                'line-join': 'round',
            },
            paint: {
                'line-color': 'rgba(71, 85, 105, 0.28)',
                'line-width': ['interpolate', ['linear'], ['zoom'], 16, 0.45, 18, 0.8],
                'line-dasharray': [0.8, 1.4],
                'line-opacity': ['interpolate', ['linear'], ['zoom'], 16, 0.18, 18, 0.36],
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
                'text-color': '#334155',
                'text-halo-color': 'rgba(255, 255, 255, 0.88)',
                'text-halo-width': 1.6,
                'text-opacity': 0.9,
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
                'text-rotation-alignment': 'viewport',
                'text-pitch-alignment': 'viewport',
                'text-keep-upright': true,
                'text-allow-overlap': false,
            },
            paint: {
                'text-color': '#111827',
                'text-halo-color': 'rgba(255, 255, 255, 0.92)',
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
                    'subway',
                    'railway',
                    'station',
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
                    ['subway', 'railway', 'station'],
                    POI_ICON_IMAGE_IDS.metro,
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
                        ['subway', 'railway', 'station'],
                        'Метро',
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
                'symbol-sort-key': [
                    'case',
                    ['match', ['coalesce', ['get', 'class'], ['get', 'subclass']], ['subway', 'railway', 'station'], true, false],
                    0,
                    1,
                ],
            },
            paint: {
                'icon-opacity': 0.92,
                'text-color': '#EAF2FF',
                'text-halo-color': 'rgba(9, 15, 27, 0.92)',
                'text-halo-width': 1.6,
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
                'text-color': '#DDE8F7',
                'text-halo-color': 'rgba(9, 15, 27, 0.92)',
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

export async function initParkingMap() {
    if (!document.getElementById(MAP_CONTAINER_ID)) {
        return;
    }

    if (!isWebGlSupported()) {
        reportMapError('Карта не поддерживается в этом браузере. Попробуйте Chrome или Safari.');
        return;
    }

    try {
        initMapLibreMap();
    } catch (error) {
        console.error('Map init failed', error);
        reportMapError('Не удалось загрузить карту. Проверьте соединение и обновите страницу.');
    }
}

function reportMapError(message) {
    window.dispatchEvent(new CustomEvent('parking:error', { detail: message }));
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
    map = new maplibregl.Map({
        container: MAP_CONTAINER_ID,
        center: MOSCOW_CENTER,
        zoom: 11.4,
        minZoom: 3,
        maxZoom: 19,
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

    bindLayerSwitcher();
    bindTrafficToggle();
    bindMapControlButtons();
    bindMapSettings();
    bindPerformanceMode();

    map.once('load', async () => {
        map.resize();
        setBaseMapLayer(getSavedBaseMapLayer());

        try {
            await addMarkerImages();
            addPoiIconImages();
            addSpeedCameraImage();
            addClusterCountImages();
            addParkingSource();
            addParkingLayers();
            addPendingSourceAndLayer();
            addUserLocationSourceAndLayer();
            addRouteSourceAndLayer();
            addSpeedCameraSourceAndLayer();
            addTrafficFlowLayer();
            bindMapEvents();
        } catch (error) {
            console.error('Map layers failed', error);
            reportMapError('Не удалось отрисовать карту. Обновите страницу.');
            return;
        }

        try {
            await loadParkingSpots();
        } catch {
            reportMapError('Не удалось загрузить точки. Проверьте соединение и попробуйте снова.');
        }
    });

    window.addEventListener('resize', () => map?.resize());
}

function scheduleParkingSpotsLoad() {
    const run = () => {
        loadParkingSpots().catch(() => {
            reportMapError('ÐÐµ ÑƒÐ´Ð°Ð»Ð¾ÑÑŒ Ð·Ð°Ð³Ñ€ÑƒÐ·Ð¸Ñ‚ÑŒ Ñ‚Ð¾Ñ‡ÐºÐ¸. ÐŸÑ€Ð¾Ð²ÐµÑ€ÑŒÑ‚Ðµ ÑÐ¾ÐµÐ´Ð¸Ð½ÐµÐ½Ð¸Ðµ Ð¸ Ð¿Ð¾Ð¿Ñ€Ð¾Ð±ÑƒÐ¹Ñ‚Ðµ ÑÐ½Ð¾Ð²Ð°.');
        });
    };

    if ('requestIdleCallback' in window) {
        window.requestIdleCallback(run, { timeout: 1200 });
        return;
    }

    window.setTimeout(run, 180);
}

async function loadParkingSpots() {
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
            'text-font': ['Open Sans Regular'],
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

    document.addEventListener('click', (event) => {
        if (switcher.contains(event.target)) {
            return;
        }

        switcher.classList.remove('is-open');
        trigger.setAttribute('aria-expanded', 'false');
    });
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
            'background-color': isSatellite ? 'rgba(0, 0, 0, 0)' : (isDark ? '#111827' : '#EEF4F1'),
            'background-opacity': isSatellite ? 0 : 1,
        },
        'water-fill': {
            'fill-color': isDark ? '#0F2A3A' : '#B9E4F2',
            'fill-opacity': isSatellite ? 0 : 1,
        },
        'park-fill': {
            'fill-color': isDark ? '#173525' : '#CFE9CE',
            'fill-opacity': isSatellite ? 0 : 0.78,
        },
        'landuse-fill': {
            'fill-color': isDark ? '#182235' : '#E2EBDF',
            'fill-opacity': isSatellite ? 0 : 0.48,
        },
        'boundary-line': {
            'line-color': isDark ? 'rgba(226, 232, 240, 0.18)' : 'rgba(71, 85, 105, 0.26)',
            'line-opacity': isSatellite ? 0 : 1,
        },
        'building-3d': {
            'fill-extrusion-color': isDark ? 'rgba(116, 139, 163, 0.58)' : 'rgba(178, 201, 214, 0.46)',
            'fill-extrusion-opacity': isSatellite ? 0 : (isDark ? 0.82 : 0.56),
        },
        'road-casing-minor': {
            'line-color': isDark ? 'rgba(255, 255, 255, 0.34)' : 'rgba(15, 23, 42, 0.32)',
            'line-opacity': isSatellite ? 0 : 0.72,
        },
        'road-casing-major': {
            'line-color': isDark ? 'rgba(255, 255, 255, 0.58)' : 'rgba(2, 6, 23, 0.42)',
            'line-opacity': isSatellite ? 0 : 0.82,
        },
        'road-minor': {
            'line-color': isDark ? '#1F2937' : '#FFFFFF',
            'line-opacity': isSatellite ? 0 : 0.94,
        },
        'road-major': {
            'line-color': isDark ? '#0B1220' : '#FFF8DF',
            'line-opacity': isSatellite ? 0 : 0.96,
        },
        'road-lane-major': {
            'line-color': isDark ? 'rgba(226, 232, 240, 0.48)' : 'rgba(71, 85, 105, 0.42)',
            'line-opacity': isSatellite ? 0 : ['interpolate', ['linear'], ['zoom'], 14, 0, 15, 0.38, 17, 0.62],
        },
        'road-lane-minor': {
            'line-color': isDark ? 'rgba(226, 232, 240, 0.32)' : 'rgba(71, 85, 105, 0.28)',
            'line-opacity': isSatellite ? 0 : ['interpolate', ['linear'], ['zoom'], 16, 0.18, 18, 0.36],
        },
        'road-name': {
            'text-color': isDark ? '#F8FAFC' : '#111827',
            'text-halo-color': isDark ? 'rgba(8, 13, 24, 0.92)' : 'rgba(255, 255, 255, 0.92)',
            'text-opacity': isSatellite ? 0 : 1,
        },
        'place-label': {
            'text-color': isDark ? '#DDE8F7' : '#334155',
            'text-halo-color': isDark ? 'rgba(15, 23, 42, 0.92)' : 'rgba(255, 255, 255, 0.88)',
            'text-opacity': isSatellite ? 0 : 0.9,
        },
        'poi-icons': {
            'icon-opacity': isSatellite ? 0 : 0.92,
            'text-color': isDark ? '#EAF2FF' : '#0F172A',
            'text-halo-color': isDark ? 'rgba(9, 15, 27, 0.92)' : 'rgba(255, 255, 255, 0.94)',
            'text-opacity': isSatellite ? 0 : 0.94,
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

function addSvgImage(name, svg, { width = 40, height = 48 } = {}) {
    if (map.hasImage(name)) {
        return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
        const image = new Image(width, height);
        image.onload = () => {
            map.addImage(name, image, { pixelRatio: 1 });
            resolve();
        };
        image.onerror = reject;
        image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    });
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
            'icon-rotate': ['get', 'heading'],
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
            'icon-image': ['concat', 'cluster-count-', ['get', 'point_count_abbreviated']],
            'icon-size': 1,
            'icon-allow-overlap': true,
            'icon-ignore-placement': true,
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
                ['/', ['get', 'accuracy'], 18],
                16,
                ['/', ['get', 'accuracy'], 2.8],
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
            'icon-rotate': ['get', 'heading'],
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
            'icon-rotate': ['get', 'heading'],
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
            'line-color': 'rgba(5, 12, 28, 0.82)',
            'line-width': ['interpolate', ['linear'], ['zoom'], 11, 13, 16, 24],
            'line-blur': ['interpolate', ['linear'], ['zoom'], 11, 1.2, 16, 2.2],
            'line-opacity': 0.58,
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
            'line-color': '#20F4FF',
            'line-width': ['interpolate', ['linear'], ['zoom'], 11, 7, 16, 13],
            'line-opacity': 0.92,
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
    map.on('click', 'clusters', async (event) => {
        await expandCluster(event);
    });
    map.on('click', 'cluster-count', async (event) => {
        await expandCluster(event);
    });

    map.on('click', 'spots-pin', (event) => selectSpotFromFeature(event.features?.[0]));

    map.on('mouseenter', 'clusters', () => setMapCursor('pointer'));
    map.on('mouseleave', 'clusters', () => setMapCursor(''));
    map.on('mouseenter', 'cluster-count', () => setMapCursor('pointer'));
    map.on('mouseleave', 'cluster-count', () => setMapCursor(''));
    map.on('mouseenter', 'spots-pin', () => setMapCursor('pointer'));
    map.on('mouseleave', 'spots-pin', () => setMapCursor(''));

    map.on('click', (event) => {
        if (!isPickingMode || clickedFeature(event.point)) {
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

function clickedFeature(point) {
    return map.queryRenderedFeatures(point, { layers: ['clusters', 'cluster-count', 'spots-pin'] }).length > 0;
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

    if (!renderedUserLocation || renderedUserLocation.headingMode !== nextLocation.headingMode) {
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
    const route = await fetchTrafficRoute(start, finish, directDistanceMeters).catch(() => {
        if (cachedRoute) {
            return {
                ...cachedRoute,
                source: `${cachedRoute.source}-cached`,
            };
        }

        return buildFallbackRoute(start, finish);
    });
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
        ROUTE_LINE_LAYER_ID,
        'clusters',
        'spots-pin',
        'cluster-count',
        'pending-spot',
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
                coordinates: sanitizeLineCoordinates(segment.coordinates ?? []),
            }))
            .filter((segment) => segment.coordinates.length > 1)
        : [];

    return {
        ...route,
        geometry: {
            type: 'LineString',
            coordinates,
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
    const routeCoordinates = sanitizeLineCoordinates(route?.geometry?.coordinates ?? []);

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

    map.getSource(ROUTE_SOURCE_ID)?.setData(buildRouteFeatureCollection({
        ...route,
        geometry: {
            type: 'LineString',
            coordinates,
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

    map.getSource(ROUTE_SOURCE_ID)?.setData(buildRouteFeatureCollection({
        ...route,
        geometry: {
            ...route.geometry,
            coordinates: routeCoordinates,
        },
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

function trimRouteSegments(segments, closestIndex) {
    let pointOffset = 0;

    return segments.map((segment) => {
        const coordinates = segment.coordinates ?? [];
        const start = pointOffset;
        const end = pointOffset + coordinates.length - 1;
        pointOffset = end;

        if (end < closestIndex) {
            return null;
        }

        return {
            ...segment,
            coordinates: coordinates.slice(Math.max(0, closestIndex - start)),
        };
    }).filter((segment) => segment?.coordinates?.length > 1);
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
            },
            geometry: {
                type: 'Point',
                coordinates: [Number(spot.longitude), Number(spot.latitude)],
            },
        })),
    };
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
