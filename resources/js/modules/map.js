import maplibregl from 'maplibre-gl';
import { fetchDrivingRoute as fetchYandexDrivingRoute, fetchParkingSpots, reverseGeocode } from './parking-api';
import { isManualMapInteraction } from './navigation-logic';

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
const BASE_LAYER_IDS = ['light', 'dark', 'satellite'];
const DEFAULT_BASE_LAYER_ID = 'light';
const BASE_LAYER_STORAGE_KEY = 'auralith:map-layer';
const ROUTE_CACHE_STORAGE_KEY = 'auralith:last-driving-route';
const TRAFFIC_LAYER_STORAGE_KEY = 'auralith:traffic-enabled';
const FOLLOW_ZOOM = 15.4;
const FOLLOW_PITCH = 50;

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
        console.error('MapLibre error', event.error);
    });

    bindLayerSwitcher();
    bindTrafficToggle();
    bindMapControlButtons();
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
            const response = await fetchParkingSpots();
            renderParkingSpots(response.data);
            window.dispatchEvent(new CustomEvent('parking:loaded', { detail: response.data }));
        } catch {
            reportMapError('Не удалось загрузить точки. Проверьте соединение и попробуйте снова.');
        }
    });

    window.addEventListener('resize', () => map?.resize());
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
                    title: camera.title ?? 'РљР°РјРµСЂР°',
                    label: camera.label ?? 'РљР°РјРµСЂР°',
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
            map.setLayoutProperty(mapLayerId, 'visibility', id === layerId ? 'visible' : 'none');
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
            map.setPaintProperty(layerIdToUpdate, property, value);
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

    map.setLayoutProperty(TRAFFIC_FLOW_LAYER_ID, 'visibility', isVisible ? 'visible' : 'none');
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

async function addMarkerImages() {
    await Promise.all(Object.entries(MARKER_IMAGES).map(([status, colors]) => (
        addSvgImage(`parking-marker-${status}`, createMarkerSvg(...colors))
    )));
    await addSvgImage(USER_LOCATION_MARKER_ID, createUserLocationSvg());
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

function addSvgImage(name, svg) {
    if (map.hasImage(name)) {
        return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
        const image = new Image(40, 48);
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
<svg xmlns="http://www.w3.org/2000/svg" width="42" height="42" viewBox="0 0 42 42">
  <defs>
    <linearGradient id="geo" x1="8" y1="34" x2="34" y2="8" gradientUnits="userSpaceOnUse">
      <stop stop-color="#8B5CF6"/>
      <stop offset="0.48" stop-color="#21A8FF"/>
      <stop offset="1" stop-color="#75F7AF"/>
    </linearGradient>
    <filter id="shadow" x="-35%" y="-35%" width="170%" height="170%">
      <feDropShadow dx="0" dy="7" stdDeviation="4.4" flood-color="#061018" flood-opacity="0.34"/>
    </filter>
  </defs>
  <path filter="url(#shadow)" fill="url(#geo)" stroke="#fff" stroke-width="2.2" d="M21 2.5 36 38 21 30.5 6 38 21 2.5Z"/>
  <path fill="#061018" opacity="0.78" stroke="rgba(255,255,255,.55)" stroke-width="1" d="M21 13.2 27 29 21 26 15 29 21 13.2Z"/>
  <circle cx="21" cy="21.4" r="3.4" fill="#fff"/>
</svg>`;
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

    map.on('movestart', (event) => {
        start();
        detachNavigationOnManualInteraction(event);
    });
    map.on('zoomstart', (event) => {
        start();
        if (event.originalEvent) {
            detachNavigationOnManualInteraction(event);
            dispatchNavigationZoomChange();
        }
    });
    map.on('moveend', stop);
    map.on('zoomend', stop);
    map.on('click', stop);
    map.on('dragstart', detachNavigationOnManualInteraction);
    map.on('rotatestart', detachNavigationOnManualInteraction);
    map.on('pitchstart', detachNavigationOnManualInteraction);
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

    map.setPaintProperty(TRAFFIC_FLOW_LAYER_ID, 'raster-opacity', isInteracting ? 0.28 : 0.70);
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
            'icon-size': 1.22,
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
            'icon-size': 1,
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
            'icon-image': USER_LOCATION_MARKER_ID,
            'icon-size': 1,
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
            'icon-image': USER_LOCATION_MARKER_ID,
            'icon-size': 1,
            'icon-rotate': ['get', 'heading'],
            'icon-pitch-alignment': 'map',
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
            'line-color': 'rgba(8, 17, 31, 0.62)',
            'line-width': ['interpolate', ['linear'], ['zoom'], 11, 12, 16, 22],
            'line-opacity': 0.68,
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
            'line-color': '#22C55E',
            'line-width': ['interpolate', ['linear'], ['zoom'], 11, 8, 16, 15],
            'line-opacity': 0.72,
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
    map.easeTo({
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

    map.easeTo({
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

    map.fitBounds(bounds, {
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

    if (!renderedUserLocation || renderedUserLocation.headingMode !== nextLocation.headingMode) {
        renderedUserLocation = { ...nextLocation };
        targetUserLocation = { ...nextLocation };
        renderUserLocationFeature(renderedUserLocation);
    } else {
        targetUserLocation = { ...nextLocation };
        startUserLocationAnimation();
    }

    if (focus) {
        map.easeTo({
            center: [nextLocation.longitude, nextLocation.latitude],
            zoom: Math.min(Math.max(map.getZoom(), 13.8), 14.8),
            duration: 260,
        });
    }
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

    cacheRoute(finish, safeRoute);
    setRouteTrafficMode(true);

    source?.setData(buildRouteFeatureCollection(safeRoute));
    if (['yandex-traffic', 'tomtom-traffic'].includes(safeRoute.source)) {
        map.setPaintProperty(ROUTE_LINE_LAYER_ID, 'line-color', [
            'match',
            ['get', 'traffic'],
            'jam',
            '#EF174A',
            'heavy',
            '#FF7A1A',
            'slow',
            '#FFD84D',
            '#22C55E',
        ]);
    } else {
        map.setPaintProperty(ROUTE_LINE_LAYER_ID, 'line-color', '#22C55E');
    }
    keepNavigationLayersOrdered();

    if (camera === 'follow') {
        focusRouteStart(safeRoute.geometry.coordinates);
    } else if (camera !== 'none') {
        const bounds = new maplibregl.LngLatBounds();
        safeRoute.geometry.coordinates.forEach((coordinate) => bounds.extend(coordinate));
        map.fitBounds(bounds, {
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

    if (map.getLayer(TRAFFIC_FLOW_LAYER_ID) && map.getLayer(ROUTE_CASING_LAYER_ID)) {
        map.moveLayer(TRAFFIC_FLOW_LAYER_ID, ROUTE_CASING_LAYER_ID);
    }

    orderedTopLayers.forEach((layerId) => {
        if (map.getLayer(layerId)) {
            map.moveLayer(layerId);
        }
    });
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

    const closestIndex = findClosestRouteCoordinateIndex(
        [Number(userLocation.longitude), Number(userLocation.latitude)],
        routeCoordinates,
    );
    const remainingCoordinates = routeCoordinates.slice(Math.max(0, closestIndex));

    if (remainingCoordinates.length < 2) {
        clearActiveRoute();
        return;
    }

    map.getSource(ROUTE_SOURCE_ID)?.setData(buildRouteFeatureCollection({
        ...route,
        geometry: {
            ...route.geometry,
            coordinates: remainingCoordinates,
        },
        segments: trimRouteSegments(route.segments ?? [], closestIndex),
    }));
}

export function updateRouteManeuverHint(instruction, route, hint = {}) {
    if (!map || !instruction || !route?.geometry?.coordinates?.length) {
        clearRouteManeuverHint();
        return;
    }

    const remainingMeters = Number(instruction.remainingMeters);
    const instructionDistanceMeters = Math.max(Number(instruction.distanceMeters) || 0, 0);
    const instructionStartMeters = Number(instruction.distanceFromStartMeters);
    const targetProgressMeters = Number.isFinite(remainingMeters) && remainingMeters <= 25 && instructionDistanceMeters > 25
        ? instructionStartMeters + instructionDistanceMeters
        : instructionStartMeters;
    const coordinate = getRouteCoordinateAtProgress(route.geometry.coordinates, targetProgressMeters);

    if (!coordinate) {
        clearRouteManeuverHint();
        return;
    }

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
            offset: [0, -18],
        }).addTo(map);
    }

    const element = routeManeuverMarker.getElement();
    const icon = element.querySelector('.route-maneuver-hint__icon');
    const distance = element.querySelector('strong');
    const text = element.querySelector('span');

    if (icon) icon.innerHTML = hint.iconSvg ?? '';
    if (distance) distance.textContent = hint.distanceText ?? '';
    if (text) text.textContent = hint.text ?? '';

    routeManeuverMarker.setLngLat(coordinate);
}

export function clearRouteManeuverHint() {
    routeManeuverMarker?.remove();
    routeManeuverMarker = null;
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

    const current = [Number(userLocation.longitude), Number(userLocation.latitude)];
    const routeCoordinates = sanitizeLineCoordinates(route?.geometry?.coordinates ?? []);
    const nextIndex = routeCoordinates.length > 1
        ? Math.min(findClosestRouteCoordinateIndex(current, routeCoordinates) + 1, routeCoordinates.length - 1)
        : -1;
    const next = routeCoordinates[nextIndex];
    const routeBearing = Number(userLocation.routeBearing);

    map.easeTo({
        center: current,
        zoom: preserveZoom ? map.getZoom() : FOLLOW_ZOOM,
        pitch: FOLLOW_PITCH,
        bearing: Number.isFinite(Number(bearing))
            ? Number(bearing)
            : (Number.isFinite(routeBearing) ? routeBearing : (next ? getBearing(current, next) : map.getBearing())),
        padding: { top: 0, right: 0, bottom: 0, left: 0 },
        retainPadding: false,
        offset: [0, Math.round(window.innerHeight * 0.30)],
        duration,
    });
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
    const next = routeCoordinates[Math.min(8, Math.max(1, routeCoordinates.length - 1))];

    if (!start) return;

    map.easeTo({
        center: start,
        zoom: FOLLOW_ZOOM,
        pitch: FOLLOW_PITCH,
        bearing: next ? getBearing(start, next) : map.getBearing(),
        offset: [0, Math.round(window.innerHeight * 0.18)],
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
