import maplibregl from 'maplibre-gl';
import { fetchParkingSpots, reverseGeocode } from './parking-api';

let map = null;
let spotsCache = [];
let pendingMarker = null;
let addressRequestId = 0;
let isPickingMode = false;

const MOSCOW_CENTER = [37.6173, 55.7558];
const MAP_CONTAINER_ID = 'parking-map';
const SOURCE_ID = 'parking-spots';
const PENDING_SOURCE_ID = 'pending-parking-spot';
const BASE_LAYER_IDS = ['light', 'dark', 'satellite'];
const DEFAULT_BASE_LAYER_ID = 'light';

const MAP_STYLE = {
    version: 8,
    glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
    sources: {
        'basemap-light': {
            type: 'raster',
            tiles: [
                'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
            ],
            tileSize: 256,
            attribution: '© OpenStreetMap contributors',
        },
        'basemap-dark': {
            type: 'raster',
            tiles: [
                'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
                'https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
                'https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
                'https://d.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
            ],
            tileSize: 256,
            attribution: '© OpenStreetMap © CARTO',
        },
        'basemap-satellite': {
            type: 'raster',
            tiles: [
                'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
            ],
            tileSize: 256,
            maxzoom: 17,
            attribution: 'Tiles © Esri',
        },
    },
    layers: [
        {
            id: 'basemap-light',
            type: 'raster',
            source: 'basemap-light',
            paint: {
                'raster-opacity': 0.96,
                'raster-saturation': -0.12,
                'raster-contrast': 0.04,
            },
        },
        {
            id: 'basemap-dark',
            type: 'raster',
            source: 'basemap-dark',
            layout: {
                visibility: 'none',
            },
            paint: {
                'raster-opacity': 0.9,
                'raster-brightness-min': 0.12,
                'raster-brightness-max': 0.86,
                'raster-contrast': -0.06,
            },
        },
        {
            id: 'basemap-satellite',
            type: 'raster',
            source: 'basemap-satellite',
            layout: {
                visibility: 'none',
            },
            paint: {
                'raster-opacity': 0.96,
                'raster-saturation': -0.08,
                'raster-contrast': -0.02,
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

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), 'top-left');
    map.addControl(new maplibregl.FullscreenControl(), 'top-right');
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');

    map.on('error', (event) => {
        console.error('MapLibre error', event.error);
    });

    bindLayerSwitcher();
    bindPerformanceMode();

    map.once('load', async () => {
        map.resize();
        setBaseMapLayer(DEFAULT_BASE_LAYER_ID);

        try {
            await addMarkerImages();
            addParkingSource();
            addParkingLayers();
            addPendingSourceAndLayer();
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

function bindLayerSwitcher() {
    const switcher = document.querySelector('[data-layer-switcher]');
    const trigger = switcher?.querySelector('[data-map-layer-toggle]');
    const panel = switcher?.querySelector('[data-map-layer-panel]');

    if (!switcher || !trigger || !panel) {
        return;
    }

    trigger.addEventListener('click', () => {
        const isOpen = switcher.classList.toggle('is-open');
        trigger.setAttribute('aria-expanded', String(isOpen));
    });

    switcher.querySelectorAll('[data-map-layer]').forEach((button) => {
        button.addEventListener('click', () => {
            setBaseMapLayer(button.dataset.mapLayer);
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

function setBaseMapLayer(layerId = DEFAULT_BASE_LAYER_ID) {
    if (!BASE_LAYER_IDS.includes(layerId)) {
        return;
    }

    BASE_LAYER_IDS.forEach((id) => {
        const mapLayerId = `basemap-${id}`;

        if (map?.getLayer(mapLayerId)) {
            map.setLayoutProperty(mapLayerId, 'visibility', id === layerId ? 'visible' : 'none');
        }
    });

    document.body.dataset.mapLayer = layerId;
    document.querySelectorAll('[data-map-layer]').forEach((button) => {
        button.classList.toggle('is-active', button.dataset.mapLayer === layerId);
    });
}

async function addMarkerImages() {
    await Promise.all(Object.entries(MARKER_IMAGES).map(([status, colors]) => (
        addSvgImage(`parking-marker-${status}`, createMarkerSvg(...colors))
    )));
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

function bindPerformanceMode() {
    let timer = null;
    const start = () => {
        document.body.classList.add('is-map-interacting');
        window.clearTimeout(timer);
    };
    const stop = () => {
        window.clearTimeout(timer);
        timer = window.setTimeout(() => document.body.classList.remove('is-map-interacting'), 180);
    };

    map.on('movestart', start);
    map.on('zoomstart', start);
    map.on('moveend', stop);
    map.on('zoomend', stop);
    map.on('click', stop);
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
        id: 'cluster-count',
        type: 'symbol',
        source: SOURCE_ID,
        filter: ['has', 'point_count'],
        layout: {
            'text-field': ['get', 'point_count_abbreviated'],
            'text-font': ['Noto Sans Regular'],
            'text-size': 14,
            'text-allow-overlap': true,
            'text-ignore-placement': true,
        },
        paint: {
            'text-color': '#F8FAFC',
            'text-halo-color': 'rgba(8, 17, 31, 0.55)',
            'text-halo-width': 1,
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
            'icon-allow-overlap': true,
            'icon-ignore-placement': true,
        },
    });
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
