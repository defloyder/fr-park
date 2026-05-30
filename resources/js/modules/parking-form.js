import {
    createParkingSpot,
    deleteParkingSpot,
    fetchAccountSession,
    fetchFavorites,
    fetchRouteSpeedCameras,
    getParkingSpotsExportUrl,
    logoutAccount,
    importParkingSpots,
    submitAuth,
    toggleFavoriteSpot,
    updateParkingSpot,
    uploadParkingPhoto,
} from './parking-api';
import { addParkingSpotToMap, buildRouteToSpot, clearActiveRoute, clearPendingSelection, focusNavigationPosition, focusSpot, focusSpots, focusUserLocation, renderSpeedCameras, replaceParkingSpotsOnMap, restoreActiveRoute, setMapPickingMode, startRouteNavigation, updateActiveRouteProgress } from './map';
import { normalizeCompassHeading, pickUpcomingSpeedCamera, shouldRecenterNavigationFromLocate } from './navigation-logic';

const STATUS_LABELS = {
    verified: 'Проверено',
    unverified: 'Не проверено',
    temporary: 'Временная',
    outdated: 'Неактуально',
};


const NAVIGATION_STATE_STORAGE_KEY = 'auralith:navigation-state';
const SPEED_CAMERA_ROUTE_DISTANCE_METERS = 160;

const MOSCOW_DISTRICT_ALIASES = {
    'патриарших прудов': 'Пресненский',
    'патриаршие пруды': 'Пресненский',
    'китай-город': 'Тверской',
    'красные ворота': 'Басманный',
};

const MOSCOW_DISTRICT_KEYWORDS = [
    { name: 'Арбат', words: ['арбат', 'старый арбат', 'новый арбат', 'смоленская'] },
    { name: 'Басманный', words: ['чистые пруды', 'чистопруд', 'красные ворота', 'мясницкая', 'покровка'] },
    { name: 'Замоскворечье', words: ['рэу', 'серпуховская', 'большая серпуховская', 'павелецкая', 'пятницкая'] },
    { name: 'Мещанский', words: ['цветной бульвар', 'трубная', 'сухаревская', 'проспект мира'] },
    { name: 'Пресненский', words: ['патриарш', 'преснен', 'маяковская', 'баррикадная', 'красная пресня'] },
    { name: 'Тверской', words: ['тверская', 'китай-город', 'пушкинская', 'охотный ряд', 'театр', 'петровка'] },
    { name: 'Якиманка', words: ['якиманка', 'полянка', 'октябрьская', 'крымский вал'] },
];

const MOSCOW_DISTRICT_BOUNDS = [
    { name: 'Замоскворечье', bounds: [55.7200, 55.7485, 37.6100, 37.6550] },
    { name: 'Якиманка', bounds: [55.7250, 55.7555, 37.5850, 37.6250] },
    { name: 'Арбат', bounds: [55.7420, 55.7585, 37.5750, 37.6075] },
    { name: 'Пресненский', bounds: [55.7480, 55.7800, 37.5350, 37.6100] },
    { name: 'Тверской', bounds: [55.7550, 55.7860, 37.5900, 37.6370] },
    { name: 'Мещанский', bounds: [55.7650, 55.7950, 37.6050, 37.6500] },
    { name: 'Басманный', bounds: [55.7500, 55.7830, 37.6250, 37.6920] },
];

const state = {
    spots: [],
    picking: false,
    editingSpotId: null,
    formPhotos: [],
    lightboxPhotos: [],
    lightboxIndex: 0,
    user: null,
    favoriteIds: new Set(),
    authMode: 'login',
    selectedSpot: null,
    exportSelectedIds: new Set(),
    userLocation: null,
    navigationSpot: null,
    navigationRoute: null,
    navigationWatchId: null,
    currentSpeedKmh: 0,
    speedLimitKmh: 60,
    listQuery: '',
    navigationMetricsTimer: null,
    navigationRouteRefreshTimer: null,
    navigationRouteRefreshInFlight: false,
    navigationLastRerouteAt: 0,
    navigationPreserveZoom: false,
    navigationSessionId: 0,
    deviceHeading: null,
    deviceHeadingUpdatedAt: 0,
    deviceHeadingCameraUpdatedAt: 0,
    deviceHeadingListener: null,
    deviceHeadingPermissionRequested: false,
    wakeLock: null,
    deferredInstallPrompt: null,
    speedCameras: [],
};

export function initParkingUi() {
    const card = document.getElementById('selected-spot-card');
    const sheet = document.getElementById('add-spot-sheet');
    const list = document.getElementById('spot-list');
    const listItems = document.getElementById('spot-list-items');
    const exportSelectionCount = document.getElementById('export-selection-count');
    const searchPanel = document.getElementById('search-panel');
    const pickPanel = document.getElementById('pick-panel');
    const profilePanel = document.getElementById('profile-panel');
    const profileTitle = document.getElementById('profile-title');
    const profileUser = document.getElementById('profile-user');
    const authForm = document.getElementById('auth-form');
    const authMessage = document.getElementById('auth-message');
    const authSubmit = document.getElementById('auth-submit');
    const favoritePanel = document.getElementById('favorite-panel');
    const favoriteList = document.getElementById('favorite-list');
    const searchInput = document.getElementById('spot-search-input');
    const listSearchInput = document.getElementById('spot-list-search-input');
    const areaSelect = document.getElementById('spot-area-select');
    const searchResults = document.getElementById('search-results');
    const statusPanel = document.getElementById('status-panel');
    const fallback = document.getElementById('map-fallback');
    const form = document.getElementById('add-spot-form');
    const importForm = document.getElementById('import-spots-form');
    const importMessage = document.getElementById('import-message');
    const importPanel = document.getElementById('import-panel');
    const exportToolbar = document.getElementById('export-toolbar');
    const formMessage = document.getElementById('form-message');
    const formTitle = document.getElementById('spot-form-title');
    const formEyebrow = document.getElementById('spot-form-eyebrow');
    const photoDropzone = document.getElementById('photo-dropzone');
    const photoFileInput = document.getElementById('photo-file-input');
    const photoCameraInput = document.getElementById('photo-camera-input');
    const photoPreviewList = document.getElementById('photo-preview-list');
    const deleteButton = document.getElementById('delete-spot-button');
    const navButtons = document.querySelectorAll('.floating-nav .nav-button[data-action]');

    if (!card || !sheet || !form) return;

    document.addEventListener('click', (event) => {
        const action = event.target.closest('[data-action]')?.dataset.action;
        if (!action) return;

        const actions = {
            'show-map': closePanels,
            'open-search': openSearch,
            'locate-me': locateMe,
            'toggle-fullscreen': toggleFullscreen,
            'close-search': closeSearch,
            'open-list': openList,
            'close-list': () => list.classList.add('hidden'),
            'open-profile': openProfile,
            'close-profile': closeProfile,
            'open-add': openCreateSheet,
            'close-add': closeSheet,
            'pick-on-map': startPicking,
            'cancel-picking': cancelPicking,
            'return-to-form': returnToForm,
            'choose-photo': () => photoFileInput.click(),
            'take-photo': () => photoCameraInput.click(),
            'copy-address': () => copyAddress(event.target.closest('[data-address]')),
            'edit-spot': () => isAdmin() && openEditSheet(Number(event.target.closest('[data-spot-id]')?.dataset.spotId)),
            'open-photo': () => openLightbox(Number(event.target.closest('[data-photo-index]')?.dataset.photoIndex)),
            'close-lightbox': closeLightbox,
            'prev-photo': () => moveLightbox(-1),
            'next-photo': () => moveLightbox(1),
            'open-route-picker': openRoutePicker,
            'close-route-picker': closeRoutePicker,
            'route-yandex': () => openExternalRoute('yandex'),
            'route-2gis': () => openExternalRoute('2gis'),
            'route-in-app': buildInAppRoute,
            'start-navigation': startNavigation,
            'recenter-navigation': recenterNavigation,
            'stop-navigation': stopNavigationMode,
            'remove-form-photo': () => removeFormPhoto(Number(event.target.closest('[data-photo-index]')?.dataset.photoIndex)),
            'delete-spot': deleteCurrentSpot,
            'toggle-export-spot': () => isAdmin() && toggleExportSpot(Number(event.target.closest('[data-spot-id]')?.dataset.spotId)),
            'export-all': () => isAdmin() && exportAllSpots(),
            'export-selected': () => isAdmin() && exportSelectedSpots(),
            'clear-export-selection': () => isAdmin() && clearExportSelection(),
            'toggle-favorite': () => toggleFavorite(Number(event.target.closest('[data-spot-id]')?.dataset.spotId)),
            'install-web-app': installWebApp,
            'logout': logout,
        };

        actions[action]?.();
    });

    window.addEventListener('navigation:manual-map-move', () => {
        if (document.body.classList.contains('is-navigation-mode')) {
            document.body.classList.add('is-navigation-detached');
            return;
        }

        document.body.classList.add('is-navigation-detached');
    });

    window.addEventListener('navigation:manual-map-zoom', () => {
        if (document.body.classList.contains('is-navigation-mode')) {
            document.body.classList.add('is-navigation-detached');
            state.navigationPreserveZoom = true;
            saveNavigationState();
        }
    });

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && document.body.classList.contains('is-navigation-following')) {
            requestNavigationWakeLock();
        }
    });

    window.addEventListener('beforeinstallprompt', (event) => {
        event.preventDefault();
        state.deferredInstallPrompt = event;
        renderInstallAppPanel();
    });

    window.addEventListener('appinstalled', () => {
        state.deferredInstallPrompt = null;
        renderInstallAppPanel();
        showToast('Auralith Maps установлен');
    });

    document.addEventListener('click', (event) => {
        const authMode = event.target.closest('[data-auth-mode]')?.dataset.authMode;
        if (!authMode) return;

        setAuthMode(authMode);
    });

    document.addEventListener('keydown', (event) => {
        if (!document.body.classList.contains('is-lightbox-open')) return;
        if (event.key === 'Escape') closeLightbox();
        if (event.key === 'ArrowLeft') moveLightbox(-1);
        if (event.key === 'ArrowRight') moveLightbox(1);
    });

    window.addEventListener('parking:loaded', (event) => {
        state.spots = event.detail ?? [];
        renderList();
        renderSearchControls();
        renderSearchResults();
        renderFavoriteList();
        restoreNavigationState();
        hideStatus();
        if (state.spots.length === 0) showStatus('Пока нет добавленных парковок. Добавьте первую точку на карту.');
    });

    loadAccountSession();

    window.addEventListener('parking:error', (event) => {
        fallback?.classList.remove('hidden');
        showStatus(event.detail);
    });

    window.addEventListener('parking:selected', (event) => {
        renderCard(event.detail);
        list.classList.add('hidden');
        searchPanel?.classList.add('hidden');
        sheet.classList.add('hidden');
        profilePanel?.classList.add('hidden');
        document.body.classList.remove('is-sheet-open');
    });

    window.addEventListener('map:coords-selected', (event) => {
        const { latitude, longitude } = event.detail;
        form.elements.latitude.value = Number(latitude).toFixed(7);
        form.elements.longitude.value = Number(longitude).toFixed(7);

        if (state.picking) {
            showFormSuccess('Координаты выбраны на карте.');
            hidePickPanel();
            openSheet();
            state.picking = false;
            setMapPickingMode(false);
        }
    });

    window.addEventListener('map:address-loading', () => {
        if (!form.elements.address.value) {
            form.elements.address.placeholder = 'Определяю адрес...';
        }
    });

    window.addEventListener('map:address-resolved', (event) => {
        const address = event.detail?.address;
        if (address) {
            form.elements.address.value = address;
        }
        form.elements.address.placeholder = address ? 'Адрес определён по карте' : 'Адрес не найден, можно ввести вручную';
    });

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        clearFormMessage();
        const payload = getPayload();

        if (!payload.title || Number.isNaN(payload.latitude) || Number.isNaN(payload.longitude)) {
            showFormError('Укажите название и координаты точки.');
            return;
        }

        setSaving(true);
        try {
            const response = state.editingSpotId
                ? await updateParkingSpot(state.editingSpotId, payload)
                : await createParkingSpot(payload);
            const spot = response.data;
            upsertSpot(spot);
            addParkingSpotToMap(spot);
            form.reset();
            closeSheet();
            renderCard(spot);
        } catch (error) {
            showFormError(getValidationMessage(error));
        } finally {
            setSaving(false);
        }
    });

    photoDropzone?.addEventListener('dragover', (event) => {
        event.preventDefault();
        photoDropzone.classList.add('is-dragover');
    });
    photoDropzone?.addEventListener('dragleave', () => photoDropzone.classList.remove('is-dragover'));
    photoDropzone?.addEventListener('drop', async (event) => {
        event.preventDefault();
        photoDropzone.classList.remove('is-dragover');
        await uploadPhotoFiles([...event.dataTransfer.files]);
    });
    photoFileInput?.addEventListener('change', async () => {
        await uploadPhotoFiles([...photoFileInput.files]);
        photoFileInput.value = '';
    });
    photoCameraInput?.addEventListener('change', async () => {
        await uploadPhotoFiles([...photoCameraInput.files]);
        photoCameraInput.value = '';
    });
    listSearchInput?.addEventListener('input', () => {
        state.listQuery = listSearchInput.value.trim().toLowerCase();
        renderList();
    });
    searchInput?.addEventListener('input', () => renderSearchResults(true));
    areaSelect?.addEventListener('change', () => renderSearchResults(true));
    authForm?.addEventListener('submit', submitAuthForm);
    importForm?.addEventListener('submit', submitImportForm);

    function getPayload() {
        const payload = Object.fromEntries(new FormData(form).entries());
        ['title', 'address', 'description', 'photo_url', 'access_instructions', 'landmarks', 'parking_notes'].forEach((field) => {
            payload[field] = payload[field]?.trim() ?? '';
        });

        payload.availability_status = payload.availability_status || 'unverified';
        payload.photo_urls = getFormPhotos();
        payload.photo_url = payload.photo_urls[0] ?? payload.photo_url;
        payload.latitude = Number(payload.latitude);
        payload.longitude = Number(payload.longitude);
        return payload;
    }

    async function uploadPhotoFiles(files) {
        const images = files.filter((file) => isUploadableImage(file));
        if (files.length > 0 && images.length === 0) return showFormError('Можно загрузить только изображения.');
        if (getFormPhotos().length + images.length > 12) return showFormError('Можно добавить до 12 фото на одну точку.');

        photoDropzone.classList.add('is-uploading');
        try {
            for (const [index, file] of images.entries()) {
                photoDropzone.querySelector('strong').textContent = images.length > 1
                    ? `Загружаю фото: ${index + 1}/${images.length}`
                    : 'Загружаю фото...';
                const response = await uploadParkingPhoto(file);
                state.formPhotos.push(response.url);
            }
            form.elements.photo_url.value = state.formPhotos[0] ?? '';
            renderPhotoPreviews();
            showFormSuccess(images.length > 1 ? 'Фотографии добавлены к точке.' : 'Фото добавлено к точке.');
        } catch (error) {
            showFormError(getValidationMessage(error));
        } finally {
            photoDropzone.classList.remove('is-uploading');
            resetDropzoneText();
        }
    }

    function isUploadableImage(file) {
        if (!file) return false;
        if (file.type?.startsWith('image/')) return true;

        return /\.(jpe?g|png|webp|heic|heif)$/i.test(file.name || '');
    }

    function renderCard(spot) {
        const photos = getSpotPhotos(spot);
        state.selectedSpot = spot;
        state.lightboxPhotos = photos;
        const photo = photos.length > 0 ? renderPhotoCarousel(photos) : '<div class="spot-card__photo-placeholder"><span>Фото места</span></div>';
        const status = getAvailabilityStatus(spot);
        const isFavorite = state.favoriteIds.has(Number(spot.id));
        const editButton = isAdmin()
            ? `<button class="edit-button" type="button" data-action="edit-spot" data-spot-id="${spot.id}">Редактировать</button>`
            : '';

        card.innerHTML = `
            <div class="spot-card__photo">${photo}</div>
            <div class="spot-card__header">
                <div>
                    <span class="spot-card__label">Auralith Maps</span>
                    <h2>${escapeHtml(spot.title)}</h2>
                </div>
                <button class="spot-card__close" type="button" aria-label="Закрыть карточку">×</button>
            </div>
            <div class="spot-card__address-row">
                <p class="spot-card__address">${escapeHtml(spot.address || 'Адрес не указан')}</p>
                <button class="copy-address-button" type="button" data-action="copy-address" data-address="${escapeAttribute(spot.address || '')}" aria-label="Скопировать адрес">
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M8 7.5A2.5 2.5 0 0 1 10.5 5H17a2.5 2.5 0 0 1 2.5 2.5V14A2.5 2.5 0 0 1 17 16.5h-6.5A2.5 2.5 0 0 1 8 14V7.5Z"></path>
                        <path d="M5 10v6.5A2.5 2.5 0 0 0 7.5 19H14"></path>
                    </svg>
                </button>
            </div>
            <div class="spot-card__meta">
                <span>${Number(spot.latitude).toFixed(4)}</span>
                <span>${Number(spot.longitude).toFixed(4)}</span>
                <span class="spot-status spot-status--${status}">${escapeHtml(getAvailabilityLabel(spot))}</span>
            </div>
            <p class="spot-card__description">${escapeHtml(spot.description || 'Описание пока не добавлено.')}</p>
            <div class="spot-card__details">
                ${renderDetail('Как заехать', spot.access_instructions)}
                ${renderDetail('Ориентиры', spot.landmarks)}
                ${renderDetail('Примечания', spot.parking_notes)}
            </div>
            <div class="spot-card__actions">
                <button class="favorite-button ${isFavorite ? 'is-favorite' : ''}" type="button" data-action="toggle-favorite" data-spot-id="${spot.id}" aria-label="${isFavorite ? 'Убрать из избранного' : 'Добавить в избранное'}">
                    <span aria-hidden="true">♥</span>
                </button>
                ${editButton}
                <button class="route-button" type="button" data-action="open-route-picker">Маршрут</button>
            </div>
        `;
        card.querySelector('.spot-card__close').addEventListener('click', () => card.classList.add('hidden'));
        card.classList.remove('hidden');
        bindPhotoCarouselCounter();
    }

    function renderPhotoCarousel(photos) {
        return `
            <div class="photo-carousel">
                ${photos.map((photo, index) => `
                    <button class="photo-slide" type="button" data-action="open-photo" data-photo-index="${index}">
                        <img src="${escapeAttribute(photo)}" alt="${escapeAttribute(`Фото парковки ${index + 1}`)}" loading="lazy">
                    </button>
                `).join('')}
            </div>
            ${photos.length > 1 ? `<div class="photo-counter">1 / ${photos.length}</div>` : ''}
        `;
    }

    function bindPhotoCarouselCounter() {
        const carousel = card.querySelector('.photo-carousel');
        const counter = card.querySelector('.photo-counter');
        if (!carousel || !counter) return;

        const total = carousel.children.length;
        const updateCounter = () => {
            const width = carousel.clientWidth || 1;
            const index = Math.min(total, Math.max(1, Math.round(carousel.scrollLeft / width) + 1));
            counter.textContent = `${index} / ${total}`;
        };

        carousel.addEventListener('scroll', () => window.requestAnimationFrame(updateCounter), { passive: true });
        updateCounter();
    }

    function renderList() {
        const canExport = isAdmin();
        const spots = getListSpots();
        listItems.innerHTML = spots.map((spot) => `
            <article class="spot-list__item">
                ${canExport ? `<button class="export-check ${state.exportSelectedIds.has(Number(spot.id)) ? 'is-checked' : ''}" type="button" data-action="toggle-export-spot" data-spot-id="${spot.id}" aria-label="Выбрать для экспорта">
                    <span aria-hidden="true"></span>
                </button>` : ''}
                <button class="spot-list__content" type="button" data-spot-id="${spot.id}">
                    <span>
                        <strong>${escapeHtml(spot.title)}</strong>
                        <small>${escapeHtml(getSpotListMeta(spot))}</small>
                    </span>
                    <em class="spot-list__status spot-list__status--${getAvailabilityStatus(spot)}">${escapeHtml(getAvailabilityLabel(spot))}</em>
                </button>
            </article>
        `).join('');

        updateExportSelectionCount();

        listItems.querySelectorAll('.spot-list__content[data-spot-id]').forEach((button) => {
            button.addEventListener('click', () => {
                const spot = state.spots.find((item) => item.id === Number(button.dataset.spotId));
                focusSpot(spot);
            });
        });
    }

    function getListSpots() {
        const filtered = state.listQuery
            ? state.spots.filter((spot) => getSpotSearchText(spot).includes(state.listQuery))
            : state.spots;

        if (!state.userLocation) {
            return filtered;
        }

        return [...filtered].sort((first, second) => (
            getDistanceMeters(state.userLocation, first) - getDistanceMeters(state.userLocation, second)
        ));
    }

    function getSpotSearchText(spot) {
        return [
            spot.title,
            spot.address,
            spot.description,
            spot.landmarks,
            spot.access_instructions,
            getSpotArea(spot),
        ].filter(Boolean).join(' ').toLowerCase();
    }

    function getSpotListMeta(spot) {
        const address = spot.address || 'Адрес не указан';
        if (!state.userLocation) {
            return address;
        }

        return `${formatDistance(getDistanceMeters(state.userLocation, spot))} · ${address}`;
    }

    async function loadAccountSession() {
        try {
            applyAccountState(await fetchAccountSession());
        } catch {
            applyAccountState({ user: null, favorite_ids: [] });
        }
    }

    function applyAccountState(data) {
        state.user = data.user ?? null;
        state.favoriteIds = new Set((data.favorite_ids ?? []).map(Number));
        updateAdminControls();
        renderList();
        renderProfile();
        renderInstallAppPanel();
        rerenderOpenCard();
    }

    function isAdmin() {
        return Boolean(state.user?.is_admin);
    }

    function updateAdminControls() {
        const canManage = isAdmin();

        importPanel?.classList.toggle('hidden', !canManage);
        exportToolbar?.classList.toggle('hidden', !canManage);
        exportSelectionCount?.classList.toggle('hidden', !canManage);

        if (!canManage) {
            state.exportSelectedIds.clear();
        }
    }

    function renderProfile() {
        if (!profilePanel) return;

        const isSignedIn = Boolean(state.user);
        profileTitle.textContent = isSignedIn ? 'Профиль' : 'Вход в профиль';
        authForm?.classList.toggle('hidden', isSignedIn);
        favoritePanel?.classList.toggle('hidden', !isSignedIn);
        profileUser?.classList.toggle('hidden', !isSignedIn);

        if (isSignedIn) {
            profileUser.innerHTML = `
                <div class="profile-avatar">${escapeHtml(getInitials(state.user.name))}</div>
                <div>
                    <strong>${escapeHtml(state.user.name)}</strong>
                    <span>${escapeHtml(state.user.email)}</span>
                </div>
            `;
            renderFavoriteList();
        }

        renderInstallAppPanel();
    }

    function renderInstallAppPanel() {
        const panel = document.getElementById('install-app-panel');
        if (!panel) return;

        const note = panel.querySelector('[data-install-app-note]');
        const label = panel.querySelector('[data-install-app-label]');
        const button = panel.querySelector('[data-action="install-web-app"]');
        const isStandalone = isWebAppInstalled();
        const canInstall = Boolean(state.deferredInstallPrompt);
        const isIos = isIosDevice();

        panel.classList.toggle('is-installed', isStandalone);
        button?.toggleAttribute('disabled', isStandalone);

        if (isStandalone) {
            if (note) note.textContent = 'Auralith Maps уже открыт как веб-приложение.';
            if (label) label.textContent = 'Установлено';
            return;
        }

        if (isIos) {
            if (note) note.textContent = 'На iPhone: Поделиться → На экран «Домой».';
            if (label) label.textContent = 'Как добавить';
            return;
        }

        if (canInstall) {
            if (note) note.textContent = 'Установите Auralith Maps как отдельное приложение.';
            if (label) label.textContent = 'Установить';
            return;
        }

        if (note) note.textContent = 'Если установка не открылась, используйте меню браузера.';
        if (label) label.textContent = 'Подсказка';
    }

    async function installWebApp() {
        if (isWebAppInstalled()) {
            showToast('Auralith Maps уже установлен');
            return;
        }

        if (state.deferredInstallPrompt) {
            const promptEvent = state.deferredInstallPrompt;
            state.deferredInstallPrompt = null;
            promptEvent.prompt();

            try {
                const choice = await promptEvent.userChoice;
                showToast(choice?.outcome === 'accepted' ? 'Установка началась' : 'Установку отменили');
            } catch {
                showToast('Откройте установку через меню браузера.');
            } finally {
                renderInstallAppPanel();
            }

            return;
        }

        showToast(isIosDevice()
            ? 'На iPhone нажмите «Поделиться», затем «На экран Домой».'
            : 'Откройте меню браузера и выберите «Установить приложение».');
    }

    function renderFavoriteList() {
        if (!favoriteList) return;

        const favorites = state.spots.filter((spot) => state.favoriteIds.has(Number(spot.id)));
        favoriteList.innerHTML = favorites.length > 0 ? favorites.map((spot) => `
            <button class="favorite-item" type="button" data-spot-id="${spot.id}">
                <span>
                    <strong>${escapeHtml(spot.title)}</strong>
                    <small>${escapeHtml(spot.address || 'Адрес не указан')}</small>
                </span>
                <em>${escapeHtml(getAvailabilityLabel(spot))}</em>
            </button>
        `).join('') : '<p class="search-empty">Здесь будут сохранённые парковки.</p>';

        favoriteList.querySelectorAll('[data-spot-id]').forEach((button) => {
            button.addEventListener('click', () => {
                const spot = state.spots.find((item) => item.id === Number(button.dataset.spotId));
                if (!spot) return;
                closeProfile();
                focusSpot(spot);
            });
        });
    }

    function rerenderOpenCard() {
        if (card.classList.contains('hidden') || !state.selectedSpot) return;

        const freshSpot = state.spots.find((spot) => spot.id === state.selectedSpot.id) ?? state.selectedSpot;
        renderCard(freshSpot);
    }

    function openProfile() {
        profilePanel?.classList.remove('hidden');
        list.classList.add('hidden');
        searchPanel?.classList.add('hidden');
        sheet.classList.add('hidden');
        card.classList.add('hidden');
        document.body.classList.remove('is-sheet-open');
        renderProfile();
    }

    function closeProfile() {
        profilePanel?.classList.add('hidden');
    }

    function setAuthMode(mode) {
        state.authMode = mode === 'register' ? 'register' : 'login';
        authForm?.querySelectorAll('[data-auth-mode]').forEach((button) => {
            button.classList.toggle('is-active', button.dataset.authMode === state.authMode);
        });
        authForm?.querySelector('.auth-name-field')?.classList.toggle('hidden', state.authMode !== 'register');
        if (authSubmit) authSubmit.textContent = state.authMode === 'register' ? 'Создать аккаунт' : 'Войти';
        clearAuthMessage();
    }

    async function submitAuthForm(event) {
        event.preventDefault();
        clearAuthMessage();

        const payload = Object.fromEntries(new FormData(authForm).entries());
        if (state.authMode === 'login') {
            delete payload.name;
        }

        authSubmit.disabled = true;
        authSubmit.textContent = state.authMode === 'register' ? 'Создаю...' : 'Вхожу...';

        try {
            applyAccountState(await submitAuth(state.authMode, payload));
            authForm.reset();
            showToast(state.authMode === 'register' ? 'Аккаунт создан' : 'Вы вошли');
        } catch (error) {
            const message = getValidationMessage(error);
            showAuthError(message);
            showToast(message, true);
        } finally {
            authSubmit.disabled = false;
            setAuthMode(state.authMode);
        }
    }

    async function logout() {
        try {
            applyAccountState(await logoutAccount());
            showToast('Вы вышли из профиля');
        } catch {
            showToast('Не удалось выйти из профиля.', true);
        }
    }

    async function toggleFavorite(id) {
        if (!id) return;

        if (!state.user) {
            openProfile();
            showAuthError('Войдите или зарегистрируйтесь, чтобы сохранять парковки.');
            return;
        }

        try {
            const response = await toggleFavoriteSpot(id);
            state.favoriteIds = new Set((response.favorite_ids ?? []).map(Number));
            renderFavoriteList();
            rerenderOpenCard();
            if (response.is_favorite) {
                card.querySelector(`[data-action="toggle-favorite"][data-spot-id="${id}"]`)?.classList.add('is-pulsing');
            }
            showToast(response.is_favorite ? 'Добавлено в избранное' : 'Удалено из избранного');
        } catch {
            showToast('Не удалось обновить избранное.', true);
        }
    }

    function renderSearchControls() {
        if (!areaSelect) return;

        const currentValue = areaSelect.value;
        const areas = [...new Set(state.spots.map(getSpotArea).filter(Boolean))]
            .sort((first, second) => first.localeCompare(second, 'ru'));

        areaSelect.innerHTML = `
            <option value="">Все районы</option>
            ${areas.map((area) => `<option value="${escapeAttribute(area)}">${escapeHtml(area)}</option>`).join('')}
        `;

        if (areas.includes(currentValue)) {
            areaSelect.value = currentValue;
        }
    }

    function renderSearchResults(shouldFocus = false) {
        if (!searchResults) return;

        const spots = getFilteredSearchSpots();
        searchResults.innerHTML = spots.length > 0 ? spots.map((spot) => `
            <button class="search-result" type="button" data-spot-id="${spot.id}">
                <span>
                    <strong>${escapeHtml(spot.title)}</strong>
                    <small>${escapeHtml(spot.address || 'Адрес не указан')}</small>
                </span>
                <em class="spot-list__status spot-list__status--${getAvailabilityStatus(spot)}">${escapeHtml(getAvailabilityLabel(spot))}</em>
            </button>
        `).join('') : '<p class="search-empty">В этой зоне пока нет подходящих точек.</p>';

        searchResults.querySelectorAll('[data-spot-id]').forEach((button) => {
            button.addEventListener('click', () => {
                const spot = state.spots.find((item) => item.id === Number(button.dataset.spotId));
                if (!spot) return;
                focusSpot(spot);
            });
        });

        if (shouldFocus && spots.length > 0) {
            focusSpots(spots);
        }
    }

    function getFilteredSearchSpots() {
        const query = searchInput?.value.trim().toLowerCase() ?? '';
        const area = areaSelect?.value ?? '';

        return state.spots.filter((spot) => {
            const matchesArea = !area || getSpotArea(spot) === area;
            const searchableText = [
                spot.title,
                spot.address,
                spot.description,
                spot.access_instructions,
                spot.landmarks,
                spot.parking_notes,
            ].filter(Boolean).join(' ').toLowerCase();

            return matchesArea && (!query || searchableText.includes(query));
        });
    }

    function renderPhotoPreviews() {
        photoPreviewList.innerHTML = getFormPhotos().map((photo, index) => `
            <div class="photo-preview">
                <img src="${escapeAttribute(photo)}" alt="${escapeAttribute(`Фото ${index + 1}`)}">
                <button type="button" data-action="remove-form-photo" data-photo-index="${index}" aria-label="Удалить фото">×</button>
            </div>
        `).join('');
    }

    function removeFormPhoto(index) {
        state.formPhotos = getFormPhotos().filter((_, photoIndex) => photoIndex !== index);
        form.elements.photo_url.value = state.formPhotos[0] ?? '';
        renderPhotoPreviews();
    }

    function openCreateSheet() {
        if (!state.user) {
            openProfile();
            showAuthError('Войдите или зарегистрируйтесь, чтобы добавить парковку.');
            return;
        }

        state.editingSpotId = null;
        state.formPhotos = [];
        form.reset();
        form.elements.availability_status.value = 'unverified';
        formEyebrow.textContent = 'Новая точка';
        formTitle.textContent = 'Добавить парковку';
        form.querySelector('[type="submit"]').textContent = 'Сохранить';
        deleteButton?.classList.add('hidden');
        resetDropzoneText();
        renderPhotoPreviews();
        openSheet();
    }

    function openEditSheet(id) {
        if (!isAdmin()) {
            showToast('Редактирование доступно только администратору.', true);
            return;
        }

        const spot = state.spots.find((item) => item.id === id);
        if (!spot) return;

        state.editingSpotId = id;
        state.formPhotos = getSpotPhotos(spot);
        formEyebrow.textContent = 'Редактирование';
        formTitle.textContent = 'Редактировать парковку';
        form.querySelector('[type="submit"]').textContent = 'Обновить';
        deleteButton?.classList.remove('hidden');

        ['title', 'address', 'description', 'photo_url', 'access_instructions', 'landmarks', 'parking_notes'].forEach((field) => {
            form.elements[field].value = spot[field] ?? '';
        });
        form.elements.availability_status.value = getAvailabilityStatus(spot);
        form.elements.photo_url.value = state.formPhotos[0] ?? '';
        form.elements.latitude.value = Number(spot.latitude).toFixed(7);
        form.elements.longitude.value = Number(spot.longitude).toFixed(7);
        resetDropzoneText(state.formPhotos.length ? `${state.formPhotos.length} фото прикреплено` : null);
        renderPhotoPreviews();
        openSheet();
    }

    function openSheet() {
        setActiveNav('open-add');
        sheet.classList.remove('hidden');
        list.classList.add('hidden');
        searchPanel?.classList.add('hidden');
        profilePanel?.classList.add('hidden');
        pickPanel?.classList.add('hidden');
        card.classList.add('hidden');
        document.body.classList.add('is-sheet-open');
    }

    async function copyAddress(button) {
        const address = button?.dataset.address;
        if (!address) return;

        try {
            await navigator.clipboard.writeText(address);
            button.classList.add('is-copied');
            button.setAttribute('aria-label', 'Адрес скопирован');
            showToast('Адрес скопирован');
            setTimeout(() => {
                button.classList.remove('is-copied');
                button.setAttribute('aria-label', 'Скопировать адрес');
            }, 1400);
        } catch {
            showToast('Не удалось скопировать адрес.', true);
        }
    }

    function closeSheet() {
        sheet.classList.add('hidden');
        clearFormMessage();
        state.picking = false;
        setMapPickingMode(false);
        hidePickPanel();
        state.editingSpotId = null;
        deleteButton?.classList.add('hidden');
        document.body.classList.remove('is-sheet-open');
        setActiveNav('show-map');
    }

    function openList() {
        setActiveNav('open-list');
        list.classList.remove('hidden');
        searchPanel?.classList.add('hidden');
        profilePanel?.classList.add('hidden');
        sheet.classList.add('hidden');
        card.classList.add('hidden');
        document.body.classList.remove('is-sheet-open');
    }

    async function locateMe() {
        if (shouldRecenterNavigationFromLocate({
            isNavigationMode: document.body.classList.contains('is-navigation-mode'),
            hasRoute: Boolean(state.navigationRoute),
        })) {
            try {
                startDeviceHeadingWatch();
                const location = await ensureUserLocation({ refresh: true, focus: false, fastFallback: true });

                state.navigationPreserveZoom = false;
                document.body.classList.remove('is-navigation-detached');
                document.body.classList.add('is-navigation-following');
                focusNavigationPosition(location, state.navigationRoute);
                if (state.navigationWatchId === null) {
                    startNavigationLocationWatch();
                    requestNavigationWakeLock();
                }
                updateNavigationMetrics();
                saveNavigationState();
            } catch {
                showToast('Не удалось вернуться к GPS. Проверьте разрешение геолокации.', true);
            }

            return;
        }

        if (!navigator.geolocation) {
            showToast('Браузер не поддерживает определение местоположения.', true);
            return;
        }

        showStatus('Определяю местоположение...');
        navigator.geolocation.getCurrentPosition(
            ({ coords }) => {
                state.userLocation = {
                    latitude: coords.latitude,
                    longitude: coords.longitude,
                    accuracy: coords.accuracy,
                    ...getDeviceHeadingLocationPatch(),
                };

                focusUserLocation(state.userLocation);
                renderList();
                openList();
                hideStatus();
                showToast('Показал ближайшие парковки рядом с вами.');
            },
            () => {
                hideStatus();
                showToast('Не удалось определить местоположение. Проверьте разрешение в браузере.', true);
            },
            {
                enableHighAccuracy: true,
                timeout: 12000,
                maximumAge: 30000,
            },
        );
    }

    function toggleFullscreen() {
        const target = document.querySelector('.map-screen') ?? document.documentElement;

        if (!document.fullscreenElement) {
            target.requestFullscreen?.();
            return;
        }

        document.exitFullscreen?.();
    }

    function openRoutePicker() {
        if (!state.selectedSpot) return;

        document.querySelector('.route-picker')?.remove();
        const spot = state.selectedSpot;
        const modal = document.createElement('section');
        modal.className = 'route-picker liquid-glass';
        modal.innerHTML = `
            <div class="route-picker__header">
                <div>
                    <span class="route-picker__eyebrow">Маршрут</span>
                    <h3>${escapeHtml(spot.title)}</h3>
                </div>
                <button class="route-picker__close" type="button" data-action="close-route-picker" aria-label="Закрыть">×</button>
            </div>
            <div class="route-picker__grid">
                <button class="route-option route-option--yandex" type="button" data-action="route-yandex">
                    <span class="route-option__logo route-option__logo--yandex" aria-hidden="true">Я</span>
                    <strong>Яндекс Карты</strong>
                    <small>с учетом их пробок</small>
                </button>
                <button class="route-option route-option--2gis" type="button" data-action="route-2gis">
                    <span class="route-option__logo route-option__logo--2gis" aria-hidden="true">2</span>
                    <strong>2ГИС</strong>
                    <small>открыть навигацию</small>
                </button>
                <button class="route-option route-option--app" type="button" data-action="route-in-app">
                    <span class="route-option__logo route-option__logo--auralith" aria-hidden="true">
                        <img src="/images/logo_transient.png?v=20260529" alt="" loading="lazy">
                    </span>
                    <strong>Auralith</strong>
                    <small>показать на карте</small>
                </button>
            </div>
            <p class="route-picker__note">Для пробок используем данные выбранного навигатора. Внутри карты строим дорожный маршрут и показываем расчет времени.</p>
            <div class="route-picker__summary" data-route-summary></div>
        `;
        document.body.append(modal);
        window.setTimeout(() => modal.classList.add('is-visible'), 20);
    }

    function closeRoutePicker() {
        const modal = document.querySelector('.route-picker');
        if (!modal) return;

        modal.classList.remove('is-visible');
        window.setTimeout(() => modal.remove(), 180);
    }

    function openExternalRoute(provider) {
        if (!state.selectedSpot) return;

        window.open(buildExternalRouteUrl(provider, state.selectedSpot), '_blank', 'noopener');
        closeRoutePicker();
    }

    async function buildInAppRoute() {
        if (!state.selectedSpot) return;

        const summary = document.querySelector('[data-route-summary]');
        const button = document.querySelector('[data-action="route-in-app"]');

        try {
            startDeviceHeadingWatch();
            button?.setAttribute('disabled', 'disabled');
            if (summary) summary.textContent = 'Строю маршрут от вашего местоположения...';
            const location = await ensureUserLocation({ refresh: true, focus: false, fastFallback: false });
            assertRouteLocation(location, state.selectedSpot);
            const route = await buildRouteToSpot(location, state.selectedSpot);
            const trafficNote = getRouteBuildNote(route);

            if (summary) {
                summary.innerHTML = `
                    <strong>${formatDuration(route.durationSeconds)}</strong>
                    <span>${formatDistance(route.distanceMeters)}</span>
                    <small>${trafficNote}</small>
                `;
            }

            enterNavigationMode(state.selectedSpot, route);
            showToast(`Маршрут: ${formatDuration(route.durationSeconds)}, ${formatDistance(route.distanceMeters)}.`);
        } catch {
            if (summary) summary.textContent = 'Не удалось построить маршрут. Проверьте геолокацию и интернет.';
            showToast('Не удалось построить маршрут. Проверьте доступ к геолокации.', true);
        } finally {
            button?.removeAttribute('disabled');
        }
    }

    function startNavigation() {
        if (document.body.classList.contains('is-navigation-following')) {
            stopNavigationMode();
            return;
        }

        if (!state.navigationRoute) return;

        startRouteNavigation(state.navigationRoute);
        document.body.classList.add('is-navigation-following');
        document.body.classList.remove('is-navigation-detached');
        state.navigationPreserveZoom = false;
        state.navigationSessionId += 1;
        startDeviceHeadingWatch();
        startNavigationLocationWatch();
        renderNavigationPanel();
        startNavigationRouteRefreshTimer();
        refreshSpeedCameras(state.navigationRoute);
        requestNavigationWakeLock();
        saveNavigationState();
    }

    function recenterNavigation() {
        if (!state.userLocation || !state.navigationRoute) return;

        state.navigationPreserveZoom = false;
        applyDeviceHeadingToUserLocation();
        focusNavigationPosition(state.userLocation, state.navigationRoute);
        document.body.classList.remove('is-navigation-detached');
        saveNavigationState();
    }

    function assertRouteLocation(location, spot) {
        const accuracy = Number(location?.accuracy) || 0;
        const distance = getDistanceMeters(
            { latitude: Number(location.latitude), longitude: Number(location.longitude) },
            { latitude: Number(spot.latitude), longitude: Number(spot.longitude) },
        );

        if (accuracy > 25000 && distance > 100000) {
            throw new Error('Location is too inaccurate for navigation.');
        }
    }

    function enterNavigationMode(spot, route) {
        state.navigationSpot = spot;
        state.navigationRoute = route;
        state.navigationSessionId += 1;

        closeRoutePicker();
        list.classList.add('hidden');
        searchPanel?.classList.add('hidden');
        profilePanel?.classList.add('hidden');
        sheet.classList.add('hidden');
        card.classList.add('hidden');
        pickPanel?.classList.add('hidden');
        document.body.classList.remove('is-sheet-open');
        document.body.classList.add('is-navigation-mode');
        document.body.classList.add('is-navigation-following');
        document.body.classList.remove('is-navigation-detached');
        state.navigationPreserveZoom = false;
        setActiveNav('show-map');
        startRouteNavigation(route);
        startDeviceHeadingWatch();
        startNavigationLocationWatch();
        renderNavigationPanel();
        startNavigationRouteRefreshTimer();
        refreshSpeedCameras(route);
        requestNavigationWakeLock();
        saveNavigationState();
    }

    function renderNavigationPanel() {
        if (!state.navigationSpot || !state.navigationRoute) return;

        if (document.body.classList.contains('is-navigation-following')) {
            let guidance = document.querySelector('.navigation-guidance');

            if (!guidance) {
                guidance = document.createElement('section');
                guidance.className = 'navigation-guidance liquid-glass';
                guidance.innerHTML = `
                <div class="navigation-guidance__arrow" aria-hidden="true"></div>
                <div class="navigation-guidance__main">
                    <strong data-navigation-maneuver-distance></strong>
                    <span data-navigation-instruction></span>
                </div>
            `;
                document.body.append(guidance);
            }

            let speedHud = document.querySelector('.navigation-speed-hud');

            if (!speedHud) {
                speedHud = document.createElement('section');
                speedHud.className = 'navigation-speed-hud liquid-glass';
                speedHud.innerHTML = `
                <div class="navigation-speedometer" aria-label="Скорость и ограничение">
                    <div class="navigation-speedometer__current">
                        <strong data-navigation-speed></strong>
                        <span>км/ч</span>
                    </div>
                    <em data-navigation-speed-limit></em>
                </div>
            `;
                document.body.append(speedHud);
            }

        }

        let panel = document.querySelector('.navigation-panel');
        if (!panel) {
            panel = document.createElement('section');
            panel.className = 'navigation-panel liquid-glass';
            panel.innerHTML = `
            <div class="navigation-panel__summary">
                <strong data-navigation-bottom-duration></strong>
                <span data-navigation-bottom-distance></span>
                <small data-navigation-bottom-note></small>
            </div>
            <div class="navigation-panel__trip">
                <strong data-navigation-trip-duration></strong>
                <span data-navigation-arrival-time></span>
                <small data-navigation-trip-distance></small>
                <em data-navigation-trip-delay></em>
            </div>
            <button class="navigation-panel__drive" type="button" data-action="start-navigation">
                <span data-navigation-drive-title></span>
                <small data-navigation-drive-note></small>
            </button>
        `;
            document.body.append(panel);
            window.setTimeout(() => panel.classList.add('is-visible'), 20);
        }

        updateNavigationMetrics();
        startNavigationMetricsTimer();
    }

    function saveNavigationState() {
        if (!state.navigationSpot || !state.navigationRoute?.geometry?.coordinates?.length) return;

        window.localStorage?.setItem(NAVIGATION_STATE_STORAGE_KEY, JSON.stringify({
            spotId: state.navigationSpot.id,
            spot: state.navigationSpot,
            route: state.navigationRoute,
            userLocation: state.userLocation,
            preserveZoom: state.navigationPreserveZoom,
            savedAt: Date.now(),
        }));
    }

    function clearNavigationState() {
        window.localStorage?.removeItem(NAVIGATION_STATE_STORAGE_KEY);
    }

    function restoreNavigationState() {
        const saved = readNavigationState();

        if (!saved?.route?.geometry?.coordinates?.length || Date.now() - Number(saved.savedAt) > 6 * 60 * 60 * 1000) {
            clearNavigationState();
            return;
        }

        const spot = state.spots.find((item) => Number(item.id) === Number(saved.spotId)) ?? saved.spot;
        if (!spot) return;

        state.navigationSpot = spot;
        state.navigationRoute = saved.route;
        state.userLocation = saved.userLocation ?? state.userLocation;
        state.navigationPreserveZoom = Boolean(saved.preserveZoom);
        state.navigationSessionId += 1;
        document.body.classList.add('is-navigation-mode', 'is-navigation-following');
        document.body.classList.remove('is-navigation-detached');
        restoreActiveRoute(saved.route);
        startDeviceHeadingWatch();
        if (state.userLocation) {
            focusUserLocation(state.userLocation, { focus: false });
            focusNavigationPosition(state.userLocation, saved.route, { preserveZoom: state.navigationPreserveZoom });
        } else {
            startRouteNavigation(saved.route);
        }
        startNavigationLocationWatch();
        renderNavigationPanel();
        startNavigationRouteRefreshTimer();
        refreshSpeedCameras(saved.route);
        requestNavigationWakeLock();
    }

    function readNavigationState() {
        try {
            return JSON.parse(window.localStorage?.getItem(NAVIGATION_STATE_STORAGE_KEY) || 'null');
        } catch {
            return null;
        }
    }

    function updateNavigationMetrics() {
        if (!state.navigationRoute) return;

        const remainingDistance = getRemainingRouteDistance();
        const remainingDuration = getRemainingRouteDuration(remainingDistance);
        const instruction = getNextRouteInstruction(state.navigationRoute, state.userLocation);
        const maneuverDistance = Number(instruction?.remainingMeters ?? instruction?.distanceMeters);
        const arrival = getArrivalTime(remainingDuration);
        const isFollowing = document.body.classList.contains('is-navigation-following');
        const isSpeeding = state.currentSpeedKmh > state.speedLimitKmh + 15;

        setText('[data-navigation-maneuver-distance]', Number.isFinite(maneuverDistance) ? formatDistance(maneuverDistance) : formatDistance(remainingDistance));
        setText('[data-navigation-instruction]', formatNavigationInstructionText(instruction?.text || 'Двигайтесь по маршруту'));
        setText('[data-navigation-traffic]', getTrafficLabel(state.navigationRoute));
        setText('[data-navigation-duration]', formatDuration(remainingDuration));
        setText('[data-navigation-distance]', formatDistance(remainingDistance));
        setText('[data-navigation-arrival]', `Прибытие ${arrival}`);
        setText('[data-navigation-speed]', String(Math.round(state.currentSpeedKmh)));
        setText('[data-navigation-speed-limit]', String(state.speedLimitKmh));
        setText('[data-navigation-bottom-duration]', formatDuration(remainingDuration));
        setText('[data-navigation-bottom-distance]', formatDistance(remainingDistance));
        setText('[data-navigation-bottom-note]', `${getTrafficLabel(state.navigationRoute)} · прибытие ${arrival}`);
        setText('[data-navigation-arrival-time]', `прибытие ${arrival}`);
        setText('[data-navigation-trip-duration]', formatDuration(remainingDuration));
        setText('[data-navigation-trip-distance]', formatDistance(remainingDistance));
        setText('[data-navigation-trip-delay]', getTrafficDelayLabel(state.navigationRoute));
        setText('[data-navigation-drive-title]', isFollowing ? 'Завершить' : 'Поехать');
        setText('[data-navigation-drive-note]', isFollowing ? `прибытие ${arrival}` : 'к началу маршрута');

        const arrow = document.querySelector('.navigation-guidance__arrow');
        if (arrow) arrow.innerHTML = getManeuverIconSvg(instruction);

        document.querySelector('.navigation-speedometer')?.classList.toggle('is-speeding', isSpeeding);
        renderCameraAlert();
    }

    function renderCameraAlert() {
        const camera = getNearestUpcomingCamera();
        let alert = document.querySelector('.navigation-camera-alert');

        if (!camera || camera.distanceMeters > 400) {
            alert?.remove();
            return;
        }

        if (!alert) {
            alert = document.createElement('section');
            alert.className = 'navigation-camera-alert liquid-glass';
            alert.innerHTML = '<strong data-camera-title></strong><span data-camera-distance></span><small data-camera-details></small>';
            document.body.append(alert);
        }

        setText('[data-camera-title]', getCameraTitle(camera));
        setText('[data-camera-distance]', `${formatDistance(camera.distanceMeters)}`);
        setText('[data-camera-details]', formatCameraDetails(camera));
    }

    function getNearestUpcomingCamera() {
        return pickUpcomingSpeedCamera(state.speedCameras, state.userLocation, state.navigationRoute, {
            getRouteProgressMeters,
            getDistanceToRouteMeters,
            routeDistanceThresholdMeters: SPEED_CAMERA_ROUTE_DISTANCE_METERS,
        });
    }

    async function refreshSpeedCameras(route) {
        if (!route?.geometry?.coordinates?.length || !document.body.classList.contains('is-navigation-mode')) {
            state.speedCameras = [];
            renderSpeedCameras([]);
            return;
        }

        const sessionId = state.navigationSessionId;

        try {
            const payload = await fetchRouteSpeedCameras(route.geometry.coordinates);

            if (sessionId !== state.navigationSessionId || !document.body.classList.contains('is-navigation-mode')) {
                state.speedCameras = [];
                renderSpeedCameras([]);
                return;
            }

            state.speedCameras = Array.isArray(payload.data) ? payload.data : [];
            renderSpeedCameras(state.speedCameras);
            updateNavigationMetrics();
        } catch {
            // The backend keeps Overpass details away from the client. Keep the
            // last known camera layer instead of making alerts blink out.
        }
    }

    function getCameraTitle(camera) {
        if (camera.isDummy) return 'Муляж';
        if (/lane|bus|redlight|traffic_signals|signal/i.test(camera.cameraType || '')) return 'Камера полосы';
        return 'Камера скорости';
    }

    function formatCameraDetails(camera) {
        const parts = [
            camera.directionLabel?.text,
            camera.maxspeed ? `лимит ${parseInt(camera.maxspeed, 10) || camera.maxspeed}` : '',
        ].filter(Boolean);

        return parts.join(' · ') || 'на маршруте';
    }

    function startNavigationMetricsTimer() {
        if (state.navigationMetricsTimer) return;

        state.navigationMetricsTimer = window.setInterval(updateNavigationMetrics, 5000);
    }

    function stopNavigationMetricsTimer() {
        window.clearInterval(state.navigationMetricsTimer);
        state.navigationMetricsTimer = null;
    }

    function setText(selector, value) {
        const element = document.querySelector(selector);
        if (element && element.textContent !== String(value)) {
            element.textContent = value;
        }
    }

    function stopNavigationMode() {
        state.navigationSessionId += 1;
        document.body.classList.remove('is-navigation-mode');
        document.body.classList.remove('is-navigation-following');
        document.body.classList.remove('is-navigation-detached');
        releaseNavigationWakeLock();
        stopNavigationLocationWatch();
        stopDeviceHeadingWatch();
        stopNavigationRouteRefreshTimer();
        document.querySelector('.navigation-panel')?.remove();
        document.querySelector('.navigation-guidance')?.remove();
        document.querySelector('.navigation-speed-hud')?.remove();
        document.querySelector('.navigation-camera-alert')?.remove();
        document.querySelector('.navigation-recenter')?.remove();
        state.speedCameras = [];
        renderSpeedCameras([]);
        state.navigationSpot = null;
        state.navigationRoute = null;
        state.navigationRouteRefreshInFlight = false;
        state.navigationLastRerouteAt = 0;
        state.navigationPreserveZoom = false;
        stopNavigationMetricsTimer();
        clearActiveRoute();
        clearNavigationState();
        window.setTimeout(clearNavigationMapOverlays, 0);
        window.setTimeout(clearNavigationMapOverlays, 250);
    }

    function clearNavigationMapOverlays() {
        clearActiveRoute();
        renderSpeedCameras([]);
    }

    async function requestNavigationWakeLock() {
        if (!('wakeLock' in navigator) || state.wakeLock || document.visibilityState !== 'visible') {
            return;
        }

        const sessionId = state.navigationSessionId;

        try {
            state.wakeLock = await navigator.wakeLock.request('screen');
            if (sessionId !== state.navigationSessionId || !document.body.classList.contains('is-navigation-following')) {
                releaseNavigationWakeLock();
                return;
            }
            state.wakeLock.addEventListener('release', () => {
                state.wakeLock = null;
            }, { once: true });
        } catch {
            state.wakeLock = null;
        }
    }

    function releaseNavigationWakeLock() {
        state.wakeLock?.release?.().catch(() => {});
        state.wakeLock = null;
    }

    async function startDeviceHeadingWatch() {
        if (state.deviceHeadingListener || !('DeviceOrientationEvent' in window)) {
            return;
        }

        const orientationEvent = window.DeviceOrientationEvent;

        if (typeof orientationEvent.requestPermission === 'function' && !state.deviceHeadingPermissionRequested) {
            state.deviceHeadingPermissionRequested = true;

            try {
                const permission = await orientationEvent.requestPermission();
                if (permission !== 'granted') return;
            } catch {
                return;
            }
        }

        const listener = (event) => {
            const screenAngle = Number(window.screen?.orientation?.angle ?? window.orientation ?? 0);
            const heading = normalizeCompassHeading(event, screenAngle);

            if (!Number.isFinite(heading)) return;

            state.deviceHeading = heading;
            state.deviceHeadingUpdatedAt = Date.now();
            applyDeviceHeadingToUserLocation();

            if (!state.userLocation) return;

            focusUserLocation(state.userLocation, { focus: false });
            const now = Date.now();
            if (
                now - state.deviceHeadingCameraUpdatedAt > 120
                && document.body.classList.contains('is-navigation-following')
                && !document.body.classList.contains('is-navigation-detached')
            ) {
                state.deviceHeadingCameraUpdatedAt = now;
                focusNavigationPosition(state.userLocation, state.navigationRoute, { preserveZoom: state.navigationPreserveZoom });
            }
        };

        state.deviceHeadingListener = listener;
        window.addEventListener('deviceorientationabsolute', listener, true);
        window.addEventListener('deviceorientation', listener, true);
    }

    function stopDeviceHeadingWatch() {
        if (!state.deviceHeadingListener) return;

        window.removeEventListener('deviceorientationabsolute', state.deviceHeadingListener, true);
        window.removeEventListener('deviceorientation', state.deviceHeadingListener, true);
        state.deviceHeadingListener = null;
    }

    function applyDeviceHeadingToUserLocation() {
        if (!state.userLocation) return;

        state.userLocation = {
            ...state.userLocation,
            ...getDeviceHeadingLocationPatch(),
            heading: getNavigationHeading(state.userLocation.gpsHeading ?? state.userLocation.heading),
        };
    }

    function getDeviceHeadingLocationPatch() {
        const compassHeading = getFreshDeviceHeading();

        if (!Number.isFinite(compassHeading)) {
            return {};
        }

        return {
            compassHeading,
            compassHeadingUpdatedAt: state.deviceHeadingUpdatedAt,
            heading: compassHeading,
        };
    }

    function getFreshDeviceHeading(maxAgeMs = 2500) {
        if (!Number.isFinite(state.deviceHeading) || Date.now() - state.deviceHeadingUpdatedAt > maxAgeMs) {
            return null;
        }

        return state.deviceHeading;
    }

    function getNavigationHeading(gpsHeading = null) {
        return getFreshDeviceHeading() ?? gpsHeading;
    }

    function startNavigationLocationWatch() {
        stopNavigationLocationWatch();

        if (!navigator.geolocation) return;

        state.navigationWatchId = navigator.geolocation.watchPosition(
            ({ coords }) => {
                const gpsHeading = getGpsHeading(coords);
                state.userLocation = {
                    latitude: coords.latitude,
                    longitude: coords.longitude,
                    accuracy: coords.accuracy,
                    gpsHeading,
                    heading: getNavigationHeading(gpsHeading),
                    compassHeading: getFreshDeviceHeading(),
                    compassHeadingUpdatedAt: state.deviceHeadingUpdatedAt,
                    updatedAt: Date.now(),
                };
                state.currentSpeedKmh = getGpsSpeedKmh(coords);
                state.speedLimitKmh = estimateSpeedLimitKmh(state.navigationRoute, state.userLocation);

                focusUserLocation(state.userLocation, { focus: false });
                updateActiveRouteProgress(state.userLocation, state.navigationRoute);
                if (!document.body.classList.contains('is-navigation-detached')) {
                    focusNavigationPosition(state.userLocation, state.navigationRoute, { preserveZoom: state.navigationPreserveZoom });
                }
                maybeRefreshNavigationRouteFromGps();
                updateNavigationMetrics();
                saveNavigationState();
            },
            () => {},
            {
                enableHighAccuracy: true,
                maximumAge: 0,
                timeout: 10000,
            },
        );
    }

    function stopNavigationLocationWatch() {
        if (state.navigationWatchId === null || !navigator.geolocation) return;

        navigator.geolocation.clearWatch(state.navigationWatchId);
        state.navigationWatchId = null;
    }

    function startNavigationRouteRefreshTimer() {
        if (state.navigationRouteRefreshTimer) return;

        state.navigationRouteRefreshTimer = window.setInterval(refreshNavigationRoute, 90000);
    }

    function stopNavigationRouteRefreshTimer() {
        window.clearInterval(state.navigationRouteRefreshTimer);
        state.navigationRouteRefreshTimer = null;
    }

    async function refreshNavigationRoute() {
        if (!state.navigationSpot || !state.userLocation || !document.body.classList.contains('is-navigation-mode')) return;
        if (state.navigationRouteRefreshInFlight) return;

        const sessionId = state.navigationSessionId;

        try {
            state.navigationRouteRefreshInFlight = true;
            const route = await buildRouteToSpot(state.userLocation, state.navigationSpot, { camera: 'none' });

            if (sessionId !== state.navigationSessionId || !document.body.classList.contains('is-navigation-mode')) {
                clearActiveRoute();
                return;
            }

            state.navigationRoute = route;
            state.speedLimitKmh = estimateSpeedLimitKmh(route, state.userLocation);
            state.navigationLastRerouteAt = Date.now();
            updateActiveRouteProgress(state.userLocation, route);
            if (!document.body.classList.contains('is-navigation-detached')) {
                focusNavigationPosition(state.userLocation, route, { preserveZoom: state.navigationPreserveZoom });
            }
            updateNavigationMetrics();
            refreshSpeedCameras(route);
            saveNavigationState();
        } catch {
            // Keep the current route if a background traffic refresh fails.
        } finally {
            state.navigationRouteRefreshInFlight = false;
        }
    }

    function maybeRefreshNavigationRouteFromGps() {
        if (!state.navigationRoute || !state.userLocation || state.navigationRouteRefreshInFlight) return;

        const now = Date.now();
        if (now - state.navigationLastRerouteAt < 25000) return;

        const distanceFromRoute = getDistanceToRouteMeters(state.navigationRoute, state.userLocation);
        const isDrivingAgainstRoute = isGpsHeadingAgainstRoute(state.navigationRoute, state.userLocation);

        if (distanceFromRoute > 80 || isDrivingAgainstRoute) {
            refreshNavigationRoute();
        }
    }

    function ensureUserLocation({ refresh = false, focus = false, fastFallback = false } = {}) {
        if (state.userLocation && !refresh) {
            return Promise.resolve(state.userLocation);
        }

        if (!navigator.geolocation) {
            return Promise.reject(new Error('Geolocation is not supported.'));
        }

        return new Promise((resolve, reject) => {
            let settled = false;
            let fallbackTimer = null;

                if (state.userLocation && fastFallback) {
                fallbackTimer = window.setTimeout(() => {
                    settled = true;
                    resolve(state.userLocation);
                }, 1200);
            }

            navigator.geolocation.getCurrentPosition(
                ({ coords }) => {
                    const nextLocation = {
                        latitude: coords.latitude,
                        longitude: coords.longitude,
                        accuracy: coords.accuracy,
                    };

                    state.userLocation = {
                        ...nextLocation,
                        ...getDeviceHeadingLocationPatch(),
                        updatedAt: Date.now(),
                    };
                    focusUserLocation(state.userLocation, { focus });

                    if (!settled) {
                        settled = true;
                        window.clearTimeout(fallbackTimer);
                        resolve(state.userLocation);
                    }
                },
                (error) => {
                    if (state.userLocation && fastFallback && !settled) {
                        settled = true;
                        window.clearTimeout(fallbackTimer);
                        resolve(state.userLocation);
                        return;
                    }

                    if (!settled) {
                        settled = true;
                        window.clearTimeout(fallbackTimer);
                        reject(error);
                    }
                },
                {
                    enableHighAccuracy: refresh,
                    timeout: state.userLocation ? 3500 : 8000,
                    maximumAge: refresh ? 10000 : 60000,
                },
            );
        });
    }

    function buildExternalRouteUrl(provider, spot) {
        const destination = `${Number(spot.latitude)},${Number(spot.longitude)}`;
        const origin = state.userLocation
            ? `${Number(state.userLocation.latitude)},${Number(state.userLocation.longitude)}`
            : '';

        if (provider === '2gis') {
            const to = `${Number(spot.longitude)},${Number(spot.latitude)}`;
            const from = state.userLocation
                ? `from/${Number(state.userLocation.longitude)},${Number(state.userLocation.latitude)}/`
                : '';

            return `https://2gis.ru/routeSearch/rsType/car/${from}to/${to}`;
        }

        return `https://yandex.ru/maps/?rtext=${encodeURIComponent(origin ? `${origin}~${destination}` : `~${destination}`)}&rtt=auto`;
    }

    function formatDistance(meters) {
        if (!Number.isFinite(Number(meters))) return '—';
        if (meters < 950) return `${Math.round(meters)} м`;
        return `${(meters / 1000).toFixed(meters < 10000 ? 1 : 0)} км`;
    }

    function formatDuration(seconds) {
        if (!Number.isFinite(Number(seconds))) return '—';
        const minutes = Math.max(1, Math.round(seconds / 60));
        if (minutes < 60) return `${minutes} мин`;
        return `${Math.floor(minutes / 60)} ч ${minutes % 60} мин`;
    }

    function closePanels() {
        setActiveNav('show-map');
        if (state.picking) {
            clearPendingSelection();
        }
        list.classList.add('hidden');
        searchPanel?.classList.add('hidden');
        profilePanel?.classList.add('hidden');
        pickPanel?.classList.add('hidden');
        sheet.classList.add('hidden');
        card.classList.add('hidden');
        state.picking = false;
        setMapPickingMode(false);
        document.body.classList.remove('is-sheet-open');
    }

    function setActiveNav(action) {
        navButtons.forEach((button) => {
            button.classList.toggle('is-active', button.dataset.action === action);
        });
    }

    function openSearch() {
        searchPanel?.classList.remove('hidden');
        list.classList.add('hidden');
        profilePanel?.classList.add('hidden');
        sheet.classList.add('hidden');
        card.classList.add('hidden');
        document.body.classList.remove('is-sheet-open');
        renderSearchControls();
        renderSearchResults();
        window.setTimeout(() => searchInput?.focus(), 80);
    }

    function closeSearch() {
        searchPanel?.classList.add('hidden');
    }

    function startPicking() {
        state.picking = true;
        setMapPickingMode(true);
        sheet.classList.add('hidden');
        card.classList.add('hidden');
        list.classList.add('hidden');
        searchPanel?.classList.add('hidden');
        document.body.classList.remove('is-sheet-open');
        showStatus('Коснитесь карты в месте парковки.');
        showPickPanel();
    }

    function cancelPicking() {
        state.picking = false;
        setMapPickingMode(false);
        clearPendingSelection();
        hidePickPanel();
        hideStatus();
        openSheet();
    }

    function returnToForm() {
        state.picking = false;
        setMapPickingMode(false);
        hidePickPanel();
        hideStatus();
        openSheet();
    }

    function showPickPanel() {
        pickPanel?.classList.remove('hidden');
    }

    function hidePickPanel() {
        pickPanel?.classList.add('hidden');
    }

    function openLightbox(index) {
        if (!state.lightboxPhotos[index]) return;
        state.lightboxIndex = index;
        renderLightbox();
        document.body.classList.add('is-lightbox-open');
    }

    function closeLightbox() {
        document.getElementById('photo-lightbox')?.remove();
        document.body.classList.remove('is-lightbox-open');
    }

    function moveLightbox(direction) {
        const total = state.lightboxPhotos.length;
        if (total <= 1) return;
        state.lightboxIndex = (state.lightboxIndex + direction + total) % total;
        renderLightbox();
    }

    function renderLightbox() {
        document.getElementById('photo-lightbox')?.remove();
        const hasManyPhotos = state.lightboxPhotos.length > 1;
        const lightbox = document.createElement('section');
        lightbox.id = 'photo-lightbox';
        lightbox.className = 'photo-lightbox';
        lightbox.innerHTML = `
            <button class="photo-lightbox__close" type="button" data-action="close-lightbox" aria-label="Закрыть">×</button>
            ${hasManyPhotos ? '<button class="photo-lightbox__nav photo-lightbox__nav--prev" type="button" data-action="prev-photo" aria-label="Предыдущее фото">‹</button>' : ''}
            <div class="photo-lightbox__stage">
                <img src="${escapeAttribute(state.lightboxPhotos[state.lightboxIndex])}" alt="${escapeAttribute(`Фото ${state.lightboxIndex + 1}`)}">
            </div>
            ${hasManyPhotos ? '<button class="photo-lightbox__nav photo-lightbox__nav--next" type="button" data-action="next-photo" aria-label="Следующее фото">›</button>' : ''}
            ${hasManyPhotos ? `<div class="photo-lightbox__counter">${state.lightboxIndex + 1} / ${state.lightboxPhotos.length}</div>` : ''}
        `;
        document.body.append(lightbox);
    }

    function upsertSpot(spot) {
        const exists = state.spots.some((item) => item.id === spot.id);
        state.spots = exists ? state.spots.map((item) => (item.id === spot.id ? spot : item)) : [spot, ...state.spots];
        if (state.selectedSpot?.id === spot.id) {
            state.selectedSpot = spot;
        }
        renderList();
        renderSearchControls();
        renderSearchResults();
        renderFavoriteList();
    }

    function upsertManySpots(spots) {
        spots.forEach((spot) => {
            const exists = state.spots.some((item) => item.id === spot.id);
            state.spots = exists ? state.spots.map((item) => (item.id === spot.id ? spot : item)) : [spot, ...state.spots];
        });

        renderList();
        renderSearchControls();
        renderSearchResults();
        renderFavoriteList();
    }

    function toggleExportSpot(id) {
        if (!id) return;

        if (state.exportSelectedIds.has(id)) {
            state.exportSelectedIds.delete(id);
        } else {
            state.exportSelectedIds.add(id);
        }

        renderList();
    }

    function clearExportSelection() {
        state.exportSelectedIds.clear();
        renderList();
    }

    function exportAllSpots() {
        window.location.href = getParkingSpotsExportUrl();
    }

    function exportSelectedSpots() {
        const ids = [...state.exportSelectedIds];

        if (ids.length === 0) {
            showToast('Выберите точки для экспорта.', true);
            return;
        }

        window.location.href = getParkingSpotsExportUrl(ids);
    }

    function updateExportSelectionCount() {
        if (!exportSelectionCount) return;

        exportSelectionCount.textContent = `Выбрано: ${state.exportSelectedIds.size}`;
    }

    async function submitImportForm(event) {
        event.preventDefault();
        clearImportMessage();

        if (!isAdmin()) {
            showImportError('Импорт доступен только администратору.');
            return;
        }

        const submitButton = importForm.querySelector('[type="submit"]');
        const file = importForm.elements.json_file?.files?.[0] ?? null;
        const text = importForm.elements.json_text?.value ?? '';

        if (!file && !text.trim()) {
            showImportError('Загрузите файл или вставьте JSON.');
            return;
        }

        submitButton.disabled = true;
        submitButton.textContent = 'Импортирую...';

        try {
            const response = await importParkingSpots({ file, text });
            const importedSpots = response.data ?? [];
            upsertManySpots(importedSpots);
            replaceParkingSpotsOnMap(state.spots);
            importForm.reset();
            showImportSuccess(`Добавлено: ${response.created_count}. Пропущено: ${response.skipped_count}. Ошибок: ${response.error_count}.`);
            showToast(`Импортировано точек: ${response.created_count}`);
        } catch (error) {
            showImportError(getValidationMessage(error));
        } finally {
            submitButton.disabled = false;
            submitButton.textContent = 'Импортировать точки';
        }
    }

    async function deleteCurrentSpot() {
        if (!state.editingSpotId || !deleteButton) return;
        if (!window.confirm('Удалить эту точку с карты?')) return;

        clearFormMessage();
        deleteButton.disabled = true;

        try {
            await deleteParkingSpot(state.editingSpotId);
            state.spots = state.spots.filter((spot) => spot.id !== state.editingSpotId);
            replaceParkingSpotsOnMap(state.spots);
            renderList();
            renderSearchControls();
            renderSearchResults();
            renderFavoriteList();
            closeSheet();
            card.classList.add('hidden');
            showStatus('Точка удалена.');
        } catch {
            showFormError('Не удалось удалить точку. Попробуйте ещё раз.');
        } finally {
            deleteButton.disabled = false;
        }
    }

    function getFormPhotos() {
        const manualPhoto = form.elements.photo_url.value.trim();
        const photos = [...state.formPhotos];
        if (manualPhoto && !photos.includes(manualPhoto)) photos.unshift(manualPhoto);
        return [...new Set(photos)].filter(Boolean);
    }

    function resetDropzoneText(message = null) {
        if (!photoDropzone) return;
        photoDropzone.querySelector('strong').textContent = message ?? 'Перетащите фото сюда';
        photoDropzone.querySelector('span').textContent = 'можно несколько файлов';
    }

    function showStatus(message) {
        statusPanel.textContent = message;
        statusPanel.classList.remove('hidden');
    }

    function hideStatus() {
        statusPanel.classList.add('hidden');
    }

    function showToast(message, isError = false) {
        document.querySelector('.app-toast')?.remove();

        const toast = document.createElement('div');
        toast.className = `app-toast${isError ? ' is-error' : ''}`;
        toast.textContent = message;
        document.body.append(toast);

        window.setTimeout(() => toast.classList.add('is-visible'), 20);
        window.setTimeout(() => {
            toast.classList.remove('is-visible');
            window.setTimeout(() => toast.remove(), 240);
        }, 1800);
    }

    function showFormSuccess(message) {
        formMessage.textContent = message;
        formMessage.classList.remove('hidden', 'is-error');
        formMessage.classList.add('is-success');
    }

    function showFormError(message) {
        formMessage.textContent = message;
        formMessage.classList.remove('hidden', 'is-success');
        formMessage.classList.add('is-error');
    }

    function clearFormMessage() {
        formMessage.textContent = '';
        formMessage.classList.add('hidden');
        formMessage.classList.remove('is-error', 'is-success');
    }

    function showAuthError(message) {
        if (!authMessage) return;
        authMessage.textContent = message;
        authMessage.classList.remove('hidden', 'is-success');
        authMessage.classList.add('is-error');
    }

    function clearAuthMessage() {
        if (!authMessage) return;
        authMessage.textContent = '';
        authMessage.classList.add('hidden');
        authMessage.classList.remove('is-error', 'is-success');
    }

    function showImportSuccess(message) {
        if (!importMessage) return;
        importMessage.textContent = message;
        importMessage.classList.remove('hidden', 'is-error');
        importMessage.classList.add('is-success');
    }

    function showImportError(message) {
        if (!importMessage) return;
        importMessage.textContent = message;
        importMessage.classList.remove('hidden', 'is-success');
        importMessage.classList.add('is-error');
    }

    function clearImportMessage() {
        if (!importMessage) return;
        importMessage.textContent = '';
        importMessage.classList.add('hidden');
        importMessage.classList.remove('is-error', 'is-success');
    }

    function setSaving(isSaving) {
        const submitButton = form.querySelector('[type="submit"]');
        submitButton.disabled = isSaving;
        submitButton.textContent = isSaving ? 'Сохраняю...' : (state.editingSpotId ? 'Обновить' : 'Сохранить');
    }
}

function getSpotPhotos(spot) {
    const photos = Array.isArray(spot.photo_urls) ? spot.photo_urls : [];
    return photos.length > 0 ? photos.filter(Boolean) : (spot.photo_url ? [spot.photo_url] : []);
}

function getAvailabilityStatus(spot) {
    if (spot.availability_status) return spot.availability_status;
    return spot.is_verified ? 'verified' : 'unverified';
}

function getAvailabilityLabel(spot) {
    return spot.availability_label || STATUS_LABELS[getAvailabilityStatus(spot)] || STATUS_LABELS.unverified;
}

function getDistanceMeters(origin, spot) {
    const latitude = Number(spot.latitude);
    const longitude = Number(spot.longitude);

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        return Number.POSITIVE_INFINITY;
    }

    const earthRadius = 6371000;
    const toRadians = (value) => value * Math.PI / 180;
    const dLat = toRadians(latitude - origin.latitude);
    const dLng = toRadians(longitude - origin.longitude);
    const lat1 = toRadians(origin.latitude);
    const lat2 = toRadians(latitude);
    const a = Math.sin(dLat / 2) ** 2
        + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

    return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatDistance(meters) {
    if (!Number.isFinite(meters)) {
        return 'далеко';
    }

    if (meters < 1000) {
        return `${Math.max(10, Math.round(meters / 10) * 10)} м`;
    }

    return `${(meters / 1000).toFixed(meters < 10000 ? 1 : 0)} км`;
}

function getInitials(name) {
    return String(name || 'PF')
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0]?.toUpperCase())
        .join('') || 'PF';
}

function isWebAppInstalled() {
    return window.matchMedia('(display-mode: standalone)').matches
        || window.navigator.standalone === true;
}

function isIosDevice() {
    return /iphone|ipad|ipod/i.test(window.navigator.userAgent)
        || (window.navigator.platform === 'MacIntel' && window.navigator.maxTouchPoints > 1);
}

function getSpotArea(spot) {
    const text = [
        spot.title,
        spot.address,
        spot.description,
        spot.access_instructions,
        spot.landmarks,
    ].filter(Boolean).join(' ').toLowerCase();

    const districtByAddress = getDistrictFromAddress(text);
    if (districtByAddress) return districtByAddress;

    const keywordDistrict = MOSCOW_DISTRICT_KEYWORDS.find(({ words }) => (
        words.some((word) => text.includes(word))
    ));
    if (keywordDistrict) return keywordDistrict.name;

    const latitude = Number(spot.latitude);
    const longitude = Number(spot.longitude);
    const boundsDistrict = MOSCOW_DISTRICT_BOUNDS.find(({ bounds }) => (
        latitude >= bounds[0] && latitude <= bounds[1] && longitude >= bounds[2] && longitude <= bounds[3]
    ));

    return boundsDistrict?.name || 'Район не определён';
}

function getDistrictFromAddress(text) {
    const district = text.match(/район\s+([^,]+)/i)?.[1]?.trim();
    if (!district) return null;

    const normalizedDistrict = district
        .replace(/^площад[ьи]\s+/i, '')
        .replace(/^улиц[аы]\s+/i, '')
        .trim();

    const alias = MOSCOW_DISTRICT_ALIASES[normalizedDistrict.toLowerCase()];

    return alias || capitalizeDistrict(normalizedDistrict);
}

function capitalizeDistrict(value) {
    return value
        .split(/\s+/)
        .map((part) => part ? `${part[0].toUpperCase()}${part.slice(1)}` : part)
        .join(' ');
}

function renderDetail(title, value) {
    if (!value) return '';
    return `<article class="spot-detail"><span>${escapeHtml(title)}</span><p>${escapeHtml(value)}</p></article>`;
}

function getValidationMessage(error) {
    return Object.values(error.errors ?? {})[0]?.[0]
        ?? error.message
        ?? 'Не удалось выполнить действие. Проверьте данные и попробуйте снова.';
}

function getNavigationInstruction(route, userLocation = null) {
    const nextInstruction = getNextRouteInstruction(route, userLocation);

    if (nextInstruction) {
        const distance = Number(nextInstruction.remainingMeters ?? nextInstruction.distanceMeters);
        const text = formatNavigationInstructionText(nextInstruction.text);

        return Number.isFinite(distance) && distance > 20
            ? `Через ${formatDistance(distance)} ${text}`
            : text;
    }

    const firstSegment = route.segments?.[0];

    if (!firstSegment) {
        return 'Двигайтесь по маршруту';
    }

    return `Двигайтесь прямо ${formatDistance(getSegmentDistance(firstSegment))}`;
}

function formatNavigationInstructionText(value) {
    let text = String(value || '').trim();

    if (!text) return 'Двигайтесь по маршруту';

    text = text
        .replace(/\bДержитесь\s+левой\s+стороны\b/giu, 'Держитесь левее')
        .replace(/\bДержитесь\s+правой\s+стороны\b/giu, 'Держитесь правее')
        .replace(/\b(на|в)\s+([А-ЯЁа-яё-]+)ая\s+улица\b/giu, 'на $2ую улицу')
        .replace(/\b(на|в)\s+([А-ЯЁа-яё-]+)яя\s+улица\b/giu, 'на $2юю улицу')
        .replace(/\bв\s+([^,.]+?)\s+улица\b/giu, 'на улице $1')
        .replace(/\bна\s+([^,.]+?)\s+улица\b/giu, 'на улицу $1')
        .replace(/\bв\s+([^,.]+?)\s+проспект\b/giu, 'на проспекте $1')
        .replace(/\bв\s+([^,.]+?)\s+шоссе\b/giu, 'на $1 шоссе')
        .replace(/\bв\s+([^,.]+?)\s+переулок\b/giu, 'в переулке $1')
        .replace(/\bв\s+([^,.]+?)\s+проезд\b/giu, 'в проезде $1')
        .replace(/\s+/g, ' ')
        .trim();

    return text ? `${text[0].toUpperCase()}${text.slice(1)}` : 'Двигайтесь по маршруту';
}

function getNextRouteInstruction(route, userLocation) {
    const instructions = route?.instructions ?? [];

    if (!instructions.length) {
        return null;
    }

    if (!userLocation || !route?.geometry?.coordinates?.length) {
        return instructions[0];
    }

    const progress = getRouteProgressMeters(route.geometry.coordinates, userLocation);
    const next = instructions.find((instruction) => (
        Number(instruction.distanceFromStartMeters) + Math.max(Number(instruction.distanceMeters) || 0, 35) >= progress + 20
    )) ?? instructions.at(-1);
    const remainingMeters = Math.max(0, Number(next.distanceFromStartMeters) - progress);

    return {
        ...next,
        remainingMeters,
    };
}

function getManeuverIconSvg(instruction) {
    const type = String(instruction?.maneuver || '').toLowerCase();
    const modifier = String(instruction?.modifier || instruction?.text || '').toLowerCase();
    const turnLeft = modifier.includes('left') || modifier.includes('налево') || modifier.includes('левее') || modifier.includes('левой');
    const turnRight = modifier.includes('right') || modifier.includes('направо') || modifier.includes('правее') || modifier.includes('правой') || type.includes('exit') || type.includes('ramp');
    const arrive = type.includes('arrive') || modifier.includes('прибы');

    if (arrive) {
        return '<svg viewBox="0 0 24 24"><path d="M12 21s7-5.2 7-11a7 7 0 0 0-14 0c0 5.8 7 11 7 11Z"></path><circle cx="12" cy="10" r="2.5"></circle></svg>';
    }

    if (turnLeft) {
        return '<svg viewBox="0 0 24 24"><path d="M6 8h9a4 4 0 0 1 4 4v8"></path><path d="m6 8 5-5"></path><path d="m6 8 5 5"></path></svg>';
    }

    if (turnRight) {
        return '<svg viewBox="0 0 24 24"><path d="M18 8H9a4 4 0 0 0-4 4v8"></path><path d="m18 8-5-5"></path><path d="m18 8-5 5"></path></svg>';
    }

    return '<svg viewBox="0 0 24 24"><path d="M12 21V4"></path><path d="m6 10 6-6 6 6"></path></svg>';
}

function getRouteProgressMeters(coordinates, userLocation) {
    const current = [Number(userLocation.longitude), Number(userLocation.latitude)];
    let progress = 0;
    let closestProgress = 0;
    let closestDistance = Number.POSITIVE_INFINITY;

    coordinates.forEach((coordinate, index) => {
        if (index > 0) {
            progress += getDistanceMeters(
                { longitude: coordinates[index - 1][0], latitude: coordinates[index - 1][1] },
                { longitude: coordinate[0], latitude: coordinate[1] },
            );
        }

        const distance = getDistanceMeters(
            { longitude: current[0], latitude: current[1] },
            { longitude: coordinate[0], latitude: coordinate[1] },
        );

        if (distance < closestDistance) {
            closestDistance = distance;
            closestProgress = progress;
        }
    });

    return closestProgress;
}

function getRemainingRouteDistance() {
    const totalDistance = Number(state.navigationRoute?.distanceMeters) || getDistanceMeters(
        state.userLocation,
        state.navigationSpot,
    );

    if (!state.userLocation || !state.navigationRoute?.geometry?.coordinates?.length) {
        return totalDistance;
    }

    return Math.max(0, totalDistance - getRouteProgressMeters(state.navigationRoute.geometry.coordinates, state.userLocation));
}

function getRemainingRouteDuration(distanceMeters) {
    const totalDistance = Number(state.navigationRoute?.distanceMeters);
    const totalDuration = Number(state.navigationRoute?.durationSeconds);

    if (totalDistance > 0 && totalDuration > 0) {
        return Math.max(30, totalDuration * (distanceMeters / totalDistance));
    }

    return distanceMeters / 9;
}

function getArrivalTime(durationSeconds) {
    const arrival = new Date(Date.now() + (Math.max(0, Number(durationSeconds) || 0) * 1000));

    return arrival.toLocaleTimeString('ru-RU', {
        hour: '2-digit',
        minute: '2-digit',
    });
}

function getTrafficLabel(route) {
    if (route.source?.endsWith('-cached')) {
        return 'Офлайн: ведение по сохраненному маршруту';
    }

    if (route.source === 'tomtom-traffic') {
        const delay = Number(route.trafficDelaySeconds) || 0;

        return delay > 60
            ? `Трафик учтен, задержка около ${formatDuration(delay)}`
            : 'Маршрут построен с учетом текущего трафика';
    }

    if (route.source === 'yandex-traffic') {
        return 'Маршрут Яндекса с учетом дорожной ситуации';
    }

    if (route.source === 'road') {
        return 'Нет ответа TomTom: проверьте ключ traffic routing';
    }

    return 'Нет данных о пробках для этого маршрута';
}

function getTrafficDelayLabel(route) {
    const delay = Number(route?.trafficDelaySeconds) || 0;

    return delay > 60 ? `задержка ${formatDuration(delay)}` : '';
}

function getGpsSpeedKmh(coords) {
    const speed = Number(coords?.speed);

    return Number.isFinite(speed) && speed > 0 ? speed * 3.6 : 0;
}

function getGpsHeading(coords) {
    const heading = Number(coords?.heading);

    return Number.isFinite(heading) && heading >= 0 ? heading : null;
}

function estimateSpeedLimitKmh(route, userLocation) {
    const speedLimit = getTomTomSpeedLimit(route, userLocation);

    if (speedLimit) {
        return speedLimit;
    }

    const instruction = getNextRouteInstruction(route, userLocation);
    const text = `${instruction?.roadName || ''} ${instruction?.text || ''}`.toLowerCase();

    if (/(мкад|кад|автобан|autobahn|motorway|highway)/i.test(text)) return 100;
    if (/(шоссе|проспект|allee|ring|tunnel|bridge|мост)/i.test(text)) return 80;
    if (/(двор|парков|проезд|residential|living)/i.test(text)) return 20;
    if (/(straße|strasse|street|lane|road)/i.test(text)) return 50;
    if (/(улица|переулок)/i.test(text)) return 60;

    return 60;
}

function getTomTomSpeedLimit(route, userLocation) {
    if (!route?.speedLimits?.length || !route?.geometry?.coordinates?.length || !userLocation) {
        return null;
    }

    const currentIndex = getClosestRouteCoordinateIndex(route.geometry.coordinates, userLocation);
    const section = route.speedLimits.find((item) => (
        Number(item.startPointIndex) <= currentIndex && Number(item.endPointIndex) >= currentIndex
    ));
    const limit = Number(section?.speedLimitKmh);

    return Number.isFinite(limit) && limit > 0 ? limit : null;
}

function getClosestRouteCoordinateIndex(coordinates, userLocation) {
    const current = [Number(userLocation.longitude), Number(userLocation.latitude)];
    let closestIndex = 0;
    let closestDistance = Number.POSITIVE_INFINITY;

    coordinates.forEach((coordinate, index) => {
        const distance = getDistanceMeters(
            { longitude: current[0], latitude: current[1] },
            { longitude: coordinate[0], latitude: coordinate[1] },
        );

        if (distance < closestDistance) {
            closestDistance = distance;
            closestIndex = index;
        }
    });

    return closestIndex;
}

function getDistanceToRouteMeters(route, userLocation) {
    const coordinates = route?.geometry?.coordinates ?? [];

    if (!coordinates.length || !userLocation) {
        return Number.POSITIVE_INFINITY;
    }

    return coordinates.reduce((closest, coordinate) => Math.min(
        closest,
        getDistanceMeters(userLocation, { latitude: coordinate[1], longitude: coordinate[0] }),
    ), Number.POSITIVE_INFINITY);
}

function isGpsHeadingAgainstRoute(route, userLocation) {
    if (userLocation?.gpsHeading === null || userLocation?.gpsHeading === undefined) {
        return false;
    }

    const heading = Number(userLocation?.gpsHeading);
    const speed = Number(state.currentSpeedKmh) || 0;
    const coordinates = route?.geometry?.coordinates ?? [];

    if (!Number.isFinite(heading) || speed < 12 || coordinates.length < 2) {
        return false;
    }

    const closestIndex = getClosestRouteCoordinateIndex(coordinates, userLocation);
    const current = coordinates[closestIndex];
    const next = coordinates[Math.min(closestIndex + 1, coordinates.length - 1)];

    if (!current || !next || current === next) {
        return false;
    }

    return getAngleDifference(heading, getBearingDegrees(current, next)) > 130;
}

function getBearingDegrees(start, finish) {
    const toRadians = (value) => value * Math.PI / 180;
    const toDegrees = (value) => value * 180 / Math.PI;
    const startLat = toRadians(start[1]);
    const finishLat = toRadians(finish[1]);
    const deltaLng = toRadians(finish[0] - start[0]);
    const y = Math.sin(deltaLng) * Math.cos(finishLat);
    const x = Math.cos(startLat) * Math.sin(finishLat)
        - Math.sin(startLat) * Math.cos(finishLat) * Math.cos(deltaLng);

    return (toDegrees(Math.atan2(y, x)) + 360) % 360;
}

function getAngleDifference(first, second) {
    return Math.abs(((first - second + 540) % 360) - 180);
}

function formatDuration(seconds) {
    if (!Number.isFinite(Number(seconds))) return '—';
    const minutes = Math.max(1, Math.round(Number(seconds) / 60));
    if (minutes < 60) return `${minutes} мин`;
    return `${Math.floor(minutes / 60)} ч ${minutes % 60} мин`;
}

function getRouteBuildNote(route) {
    if (route.source?.endsWith('-cached')) {
        return 'Показал сохраненный маршрут. Можно продолжать ведение без интернета.';
    }

    if (route.source === 'tomtom-traffic') {
        return 'Маршрут построен с учетом текущего трафика.';
    }

    if (route.source === 'yandex-traffic') {
        return 'Маршрут построен через Яндекс с учетом дорожной ситуации.';
    }

    if (route.source === 'road') {
        return 'Построил резервный маршрут OSRM: TomTom traffic routing не ответил.';
    }

    return 'Показал приблизительный маршрут: traffic routing сейчас недоступен.';
}

function getSegmentDistance(segment) {
    const coordinates = segment.coordinates ?? [];
    let distance = 0;

    for (let index = 1; index < coordinates.length; index += 1) {
        distance += getDistanceMeters(
            { longitude: coordinates[index - 1][0], latitude: coordinates[index - 1][1] },
            { longitude: coordinates[index][0], latitude: coordinates[index][1] },
        );
    }

    return distance;
}

function escapeHtml(value) {
    return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

function escapeAttribute(value) {
    return escapeHtml(value).replaceAll('`', '&#096;');
}
