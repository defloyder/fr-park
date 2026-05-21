import { fetchParkingSpots } from './parking-api';

let map = null;
let clusterer = null;
let spotsCache = [];
let pendingPlacemark = null;

const MOSCOW_CENTER = [55.7558, 37.6173];
const MAP_TYPE_STORAGE_KEY = 'parkfree:map-type';
const DEFAULT_MAP_TYPE = 'yandex#map';
const LIGHT_UI_MAP_TYPES = ['yandex#satellite', 'yandex#hybrid'];

export function initYandexMap() {
    if (!document.getElementById('yandex-map')) {
        return;
    }

    if (!window.ymaps) {
        window.dispatchEvent(new CustomEvent('parking:error', {
            detail: 'Добавьте ключ Яндекс.Карт в .env, чтобы увидеть интерактивную карту.',
        }));
        return;
    }

    window.ymaps.ready(async () => {
        map = new window.ymaps.Map('yandex-map', {
            center: MOSCOW_CENTER,
            zoom: 12,
            type: getStoredMapType(),
            controls: ['zoomControl', 'geolocationControl', 'typeSelector', 'fullscreenControl'],
        }, {
            suppressMapOpenBlock: true,
            yandexMapDisablePoiInteractivity: true,
        });

        map.behaviors.enable(['drag', 'scrollZoom', 'multiTouch']);
        map.options.set('scrollZoomSpeed', 5);
        syncMapTheme();
        map.events.add('typechange', () => {
            saveMapType();
            syncMapTheme();
        });

        clusterer = new window.ymaps.Clusterer({
            clusterDisableClickZoom: false,
            clusterHideIconOnBalloonOpen: false,
            geoObjectHideIconOnBalloonOpen: false,
            gridSize: 80,
            maxZoom: 15,
            clusterIconLayout: window.ymaps.templateLayoutFactory.createClass(
                '<div class="map-cluster">$[properties.geoObjects.length]</div>',
            ),
            clusterIconShape: {
                type: 'Circle',
                coordinates: [0, 0],
                radius: 22,
            },
        });

        map.geoObjects.add(clusterer);
        bindMapEvents();

        try {
            const response = await fetchParkingSpots();
            renderParkingSpots(response.data);
            window.dispatchEvent(new CustomEvent('parking:loaded', { detail: response.data }));
        } catch {
            window.dispatchEvent(new CustomEvent('parking:error', {
                detail: 'Не удалось загрузить точки. Проверьте соединение и попробуйте снова.',
            }));
        }
    });
}

function getStoredMapType() {
    const storedType = window.localStorage?.getItem(MAP_TYPE_STORAGE_KEY);
    const allowedTypes = ['yandex#map', 'yandex#satellite', 'yandex#hybrid'];

    return allowedTypes.includes(storedType) ? storedType : DEFAULT_MAP_TYPE;
}

function saveMapType() {
    const currentType = getCurrentMapType();

    if (currentType) {
        window.localStorage?.setItem(MAP_TYPE_STORAGE_KEY, currentType);
    }
}

function syncMapTheme() {
    document.body.classList.toggle('map-theme-light', LIGHT_UI_MAP_TYPES.includes(getCurrentMapType()));
}

function getCurrentMapType() {
    return typeof map?.getType === 'function' ? map.getType() : DEFAULT_MAP_TYPE;
}

export function addParkingSpotToMap(spot) {
    const exists = spotsCache.some((item) => item.id === spot.id);
    spotsCache = exists
        ? spotsCache.map((item) => (item.id === spot.id ? spot : item))
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

    map.setCenter([spot.latitude, spot.longitude], 15, { duration: 220 });
    window.dispatchEvent(new CustomEvent('parking:selected', { detail: spot }));
}

export function focusSpots(spots) {
    if (!map || !spots?.length) {
        return;
    }

    if (spots.length === 1) {
        map.setCenter([spots[0].latitude, spots[0].longitude], 15, { duration: 220 });
        return;
    }

    const coordinates = spots.map((spot) => [spot.latitude, spot.longitude]);
    map.setBounds(window.ymaps.util.bounds.fromPoints(coordinates), {
        checkZoomRange: true,
        duration: 220,
        zoomMargin: [90, 90, 120, 90],
    });
}

export function clearPendingSelection() {
    if (!map || !pendingPlacemark) {
        return;
    }

    map.geoObjects.remove(pendingPlacemark);
    pendingPlacemark = null;
}

function bindMapEvents() {
    map.events.add('click', (event) => {
        const coords = event.get('coords');
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

async function resolveAddress(coords) {
    if (!window.ymaps?.geocode) {
        return;
    }

    window.dispatchEvent(new CustomEvent('map:address-loading'));

    try {
        const result = await window.ymaps.geocode(coords, { results: 1 });
        const firstGeoObject = result.geoObjects.get(0);
        const address = firstGeoObject?.getAddressLine();

        window.dispatchEvent(new CustomEvent('map:address-resolved', {
            detail: {
                address: address || '',
            },
        }));
    } catch {
        window.dispatchEvent(new CustomEvent('map:address-resolved', {
            detail: {
                address: '',
            },
        }));
    }
}

function renderParkingSpots(spots) {
    spotsCache = spots;
    clusterer.removeAll();

    const markerLayout = window.ymaps.templateLayoutFactory.createClass(
        '<div class="map-marker $[properties.markerClass]" title="$[properties.hintContent]"><span></span></div>',
    );

    const placemarks = spots.map((spot) => {
        const placemark = new window.ymaps.Placemark(
            [spot.latitude, spot.longitude],
            {
                hintContent: spot.title,
                markerClass: `map-marker--${getAvailabilityStatus(spot)}`,
            },
            {
                iconLayout: markerLayout,
                iconShape: {
                    type: 'Circle',
                    coordinates: [0, 0],
                    radius: 15,
                },
                iconOffset: [-15, -15],
                openEmptyBalloon: false,
            },
        );

        placemark.events.add('click', () => {
            window.dispatchEvent(new CustomEvent('parking:selected', { detail: spot }));
        });

        return placemark;
    });

    clusterer.add(placemarks);
}

function getAvailabilityStatus(spot) {
    if (spot.availability_status) {
        return spot.availability_status;
    }

    return spot.is_verified ? 'verified' : 'unverified';
}

function setPendingCoords(coords) {
    if (!map) {
        return;
    }

    if (pendingPlacemark) {
        map.geoObjects.remove(pendingPlacemark);
    }

    const pendingLayout = window.ymaps.templateLayoutFactory.createClass(
        '<div class="map-marker map-marker--new" title="Новая точка"><span></span></div>',
    );

    pendingPlacemark = new window.ymaps.Placemark(
        coords,
        { hintContent: 'Новая точка' },
        {
            iconLayout: pendingLayout,
            iconShape: {
                type: 'Circle',
                coordinates: [0, 0],
                radius: 15,
            },
            iconOffset: [-15, -15],
        },
    );

    map.geoObjects.add(pendingPlacemark);
}
