import { fetchParkingSpots, reverseGeocode } from './parking-api';

let map = null;
let clusterer = null;
let spotsCache = [];
let pendingPlacemark = null;
let addressRequestId = 0;
let isPickingMode = false;

const MOSCOW_CENTER = [55.7558, 37.6173];
const MAP_TYPE_STORAGE_KEY = 'auralith:map-type';
const DEFAULT_MAP_TYPE = 'yandex#map';
const LIGHT_UI_MAP_TYPES = ['yandex#satellite', 'yandex#hybrid'];

export async function initYandexMap() {
    if (!document.getElementById('yandex-map')) {
        return;
    }

    if (document.querySelector('.map-screen')?.dataset.yandexApiReady !== 'true') {
        window.dispatchEvent(new CustomEvent('parking:error', {
            detail: 'Добавьте ключ Яндекс.Карт в .env, чтобы увидеть интерактивную карту.',
        }));
        return;
    }

    try {
        await waitForYmaps();
    } catch {
        window.dispatchEvent(new CustomEvent('parking:error', {
            detail: 'Не удалось загрузить Яндекс.Карты. Проверьте соединение и обновите страницу.',
        }));
        return;
    }

    window.ymaps.ready(async () => {
        const isMobile = window.matchMedia('(max-width: 520px)').matches;

        map = new window.ymaps.Map('yandex-map', {
            center: MOSCOW_CENTER,
            zoom: 12,
            type: getStoredMapType(),
            controls: ['zoomControl', 'typeSelector', 'fullscreenControl'],
        }, {
            suppressMapOpenBlock: true,
            yandexMapDisablePoiInteractivity: true,
            viewportMargin: 64,
        });

        map.behaviors.enable(['drag', 'scrollZoom', 'multiTouch']);
        map.options.set('scrollZoomSpeed', isMobile ? 3 : 5);
        configureMapControls(isMobile);
        syncMapTheme();
        map.events.add('typechange', () => {
            saveMapType();
            syncMapTheme();
        });

        clusterer = new window.ymaps.Clusterer({
            clusterDisableClickZoom: false,
            clusterHideIconOnBalloonOpen: false,
            geoObjectHideIconOnBalloonOpen: false,
            gridSize: isMobile ? 128 : 112,
            maxZoom: isMobile ? 16 : 15,
            minClusterSize: 3,
            clusterIconLayout: window.ymaps.templateLayoutFactory.createClass(
                '<div class="map-cluster">$[properties.geoObjects.length]</div>',
            ),
            clusterIconShape: {
                type: 'Circle',
                coordinates: [17, 17],
                radius: 17,
            },
            clusterIconOffset: [-17, -17],
        });

        map.geoObjects.add(clusterer);
        bindMapEvents();
        bindPerformanceMode();

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

    map.events.add(['actionbegin', 'boundschange'], start);
    map.events.add(['actionend', 'click'], stop);
}

function waitForYmaps(timeout = 10000) {
    if (window.ymaps) {
        return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
        const startedAt = Date.now();
        const interval = window.setInterval(() => {
            if (window.ymaps) {
                window.clearInterval(interval);
                resolve();
                return;
            }

            if (Date.now() - startedAt > timeout) {
                window.clearInterval(interval);
                reject(new Error('Yandex Maps API timeout'));
            }
        }, 80);
    });
}

function configureMapControls(isMobile) {
    const topOffset = isMobile ? 96 : 16;

    setControlPosition('zoomControl', {
        top: isMobile ? 112 : 110,
        left: isMobile ? 10 : 12,
    });
    setControlPosition('typeSelector', {
        top: topOffset,
        right: isMobile ? 10 : 12,
    });
    setControlPosition('fullscreenControl', {
        top: topOffset + 42,
        right: isMobile ? 10 : 12,
    });
}

function setControlPosition(name, position) {
    const control = map.controls.get(name);

    control?.options.set({
        float: 'none',
        position,
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

export function setMapPickingMode(isActive) {
    isPickingMode = isActive;
}

function bindMapEvents() {
    map.events.add('click', (event) => {
        if (!isPickingMode) {
            return;
        }

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

    const requestId = ++addressRequestId;
    window.dispatchEvent(new CustomEvent('map:address-loading'));

    try {
        const address = await geocodeAddress(coords);

        if (requestId !== addressRequestId) {
            return;
        }

        window.dispatchEvent(new CustomEvent('map:address-resolved', {
            detail: {
                address: address || '',
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

async function geocodeAddress(coords) {
    const serverAddress = await geocodeAddressOnServer(coords);

    if (serverAddress) {
        return serverAddress;
    }

    const attempts = [
        { kind: 'house', results: 5 },
        { kind: 'street', results: 5 },
        { results: 7 },
    ];

    for (const options of attempts) {
        const result = await window.ymaps.geocode(coords, {
            ...options,
            boundedBy: map?.getBounds?.(),
            strictBounds: false,
        });
        const address = getBestAddressFromGeocode(result);

        if (address) {
            return address;
        }
    }

    return '';
}

async function geocodeAddressOnServer(coords) {
    try {
        const response = await reverseGeocode(coords[0], coords[1]);

        return typeof response.address === 'string' ? response.address.trim() : '';
    } catch {
        return '';
    }
}

function getBestAddressFromGeocode(result) {
    const geoObjects = result.geoObjects;

    for (let index = 0; index < geoObjects.getLength(); index += 1) {
        const geoObject = geoObjects.get(index);
        const address = [
            geoObject?.getAddressLine?.(),
            geoObject?.properties?.get?.('metaDataProperty.GeocoderMetaData.text'),
            geoObject?.properties?.get?.('description'),
            geoObject?.properties?.get?.('name'),
        ].find((value) => typeof value === 'string' && value.trim().length > 0);

        if (address) {
            return address.trim();
        }
    }

    return '';
}

function renderParkingSpots(spots) {
    spotsCache = spots;
    clusterer.removeAll();

    const markerLayout = window.ymaps.templateLayoutFactory.createClass(
        `<div class="map-marker $[properties.markerClass]" title="$[properties.hintContent]">
            <svg viewBox="0 0 100 120" aria-hidden="true">
                <path class="map-marker__pin" d="M50 114C50 114 15 70 15 42C15 21.5655 30.67 6 50 6C69.33 6 85 21.5655 85 42C85 70 50 114 50 114Z"></path>
                <circle class="map-marker__core" cx="50" cy="42" r="27"></circle>
                <text x="50" y="56" text-anchor="middle">P</text>
            </svg>
        </div>`,
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
                    coordinates: [20, 24],
                    radius: 20,
                },
                iconOffset: [-20, -48],
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
        `<div class="map-marker map-marker--new" title="Новая точка">
            <svg viewBox="0 0 100 120" aria-hidden="true">
                <path class="map-marker__pin" d="M50 114C50 114 15 70 15 42C15 21.5655 30.67 6 50 6C69.33 6 85 21.5655 85 42C85 70 50 114 50 114Z"></path>
                <circle class="map-marker__core" cx="50" cy="42" r="27"></circle>
                <text x="50" y="56" text-anchor="middle">P</text>
            </svg>
        </div>`,
    );

    pendingPlacemark = new window.ymaps.Placemark(
        coords,
        { hintContent: 'Новая точка' },
        {
            iconLayout: pendingLayout,
            iconShape: {
                type: 'Circle',
                coordinates: [20, 24],
                radius: 20,
            },
            iconOffset: [-20, -48],
        },
    );

    map.geoObjects.add(pendingPlacemark);
}
