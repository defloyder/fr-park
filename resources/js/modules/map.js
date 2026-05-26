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

const MAP_STYLE = {
    version: 8,
    sources: {
        basemap: {
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
    },
    layers: [
        {
            id: 'basemap',
            type: 'raster',
            source: 'basemap',
        },
    ],
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

    bindPerformanceMode();

    map.once('load', async () => {
        map.resize();

        try {
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
        id: 'spots-pin',
        type: 'circle',
        source: SOURCE_ID,
        filter: ['!', ['has', 'point_count']],
        paint: {
            'circle-color': ['get', 'markerColor'],
            'circle-radius': 16,
            'circle-stroke-width': 5,
            'circle-stroke-color': ['get', 'markerHalo'],
            'circle-opacity': 0.96,
        },
    });

    map.addLayer({
        id: 'spots-symbol',
        type: 'circle',
        source: SOURCE_ID,
        filter: ['!', ['has', 'point_count']],
        paint: {
            'circle-color': '#08111F',
            'circle-radius': 6,
            'circle-opacity': 0.9,
        },
    });
}

function addPendingSourceAndLayer() {
    map.addSource(PENDING_SOURCE_ID, {
        type: 'geojson',
        data: buildFeatureCollection([]),
    });

    map.addLayer({
        id: 'pending-spot-halo',
        type: 'circle',
        source: PENDING_SOURCE_ID,
        paint: {
            'circle-color': 'rgba(0, 212, 255, 0.22)',
            'circle-radius': 22,
            'circle-stroke-width': 2,
            'circle-stroke-color': '#F8FAFC',
        },
    });

    map.addLayer({
        id: 'pending-spot',
        type: 'circle',
        source: PENDING_SOURCE_ID,
        paint: {
            'circle-color': '#00D4FF',
            'circle-radius': 10,
            'circle-stroke-width': 4,
            'circle-stroke-color': 'rgba(248, 250, 252, 0.82)',
        },
    });
}

function bindMapEvents() {
    map.on('click', 'clusters', async (event) => {
        const feature = map.queryRenderedFeatures(event.point, { layers: ['clusters'] })[0];
        const clusterId = feature?.properties?.cluster_id;
        const source = map.getSource(SOURCE_ID);

        if (!source || clusterId === undefined) return;

        const zoom = await source.getClusterExpansionZoom(clusterId);
        map.easeTo({
            center: feature.geometry.coordinates,
            zoom,
            duration: 220,
        });
    });

    map.on('click', 'spots-pin', (event) => selectSpotFromFeature(event.features?.[0]));
    map.on('click', 'spots-symbol', (event) => selectSpotFromFeature(event.features?.[0]));

    map.on('mouseenter', 'clusters', () => setMapCursor('pointer'));
    map.on('mouseleave', 'clusters', () => setMapCursor(''));
    map.on('mouseenter', 'spots-pin', () => setMapCursor('pointer'));
    map.on('mouseleave', 'spots-pin', () => setMapCursor(''));
    map.on('mouseenter', 'spots-symbol', () => setMapCursor('pointer'));
    map.on('mouseleave', 'spots-symbol', () => setMapCursor(''));

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

function clickedFeature(point) {
    return map.queryRenderedFeatures(point, { layers: ['clusters', 'spots-pin', 'spots-symbol'] }).length > 0;
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
