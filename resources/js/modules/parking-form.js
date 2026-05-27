import {
    createParkingSpot,
    deleteParkingSpot,
    fetchAccountSession,
    fetchFavorites,
    getParkingSpotsExportUrl,
    logoutAccount,
    importParkingSpots,
    submitAuth,
    toggleFavoriteSpot,
    updateParkingSpot,
    uploadParkingPhoto,
} from './parking-api';
import { addParkingSpotToMap, buildRouteToSpot, clearActiveRoute, clearPendingSelection, focusSpot, focusSpots, focusUserLocation, replaceParkingSpotsOnMap, setMapPickingMode, startRouteNavigation } from './map';

const STATUS_LABELS = {
    verified: 'Проверено',
    unverified: 'Не проверено',
    temporary: 'Временная',
    outdated: 'Неактуально',
};

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
            'stop-navigation': stopNavigationMode,
            'remove-form-photo': () => removeFormPhoto(Number(event.target.closest('[data-photo-index]')?.dataset.photoIndex)),
            'delete-spot': deleteCurrentSpot,
            'toggle-export-spot': () => isAdmin() && toggleExportSpot(Number(event.target.closest('[data-spot-id]')?.dataset.spotId)),
            'export-all': () => isAdmin() && exportAllSpots(),
            'export-selected': () => isAdmin() && exportSelectedSpots(),
            'clear-export-selection': () => isAdmin() && clearExportSelection(),
            'toggle-favorite': () => toggleFavorite(Number(event.target.closest('[data-spot-id]')?.dataset.spotId)),
            'logout': logout,
        };

        actions[action]?.();
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
        const images = files.filter((file) => file?.type.startsWith('image/'));
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
        if (!state.userLocation) {
            return state.spots;
        }

        return [...state.spots].sort((first, second) => (
            getDistanceMeters(state.userLocation, first) - getDistanceMeters(state.userLocation, second)
        ));
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

    function locateMe() {
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
                    <span>Я</span>
                    <strong>Яндекс Карты</strong>
                    <small>с учетом их пробок</small>
                </button>
                <button class="route-option route-option--2gis" type="button" data-action="route-2gis">
                    <span>2</span>
                    <strong>2ГИС</strong>
                    <small>открыть навигацию</small>
                </button>
                <button class="route-option route-option--app" type="button" data-action="route-in-app">
                    <span>⌁</span>
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
            button?.setAttribute('disabled', 'disabled');
            if (summary) summary.textContent = 'Строю маршрут от вашего местоположения...';
            const location = await ensureUserLocation({ refresh: true, focus: false, fastFallback: false });
            assertRouteLocation(location, state.selectedSpot);
            const route = await buildRouteToSpot(location, state.selectedSpot);
            const trafficNote = route.source === 'road'
                ? 'Дорожный маршрут построен. Пробки внутри карты появятся после подключения traffic API.'
                : 'Показал приблизительный маршрут, сервис дорог сейчас недоступен.';

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
        if (!state.navigationRoute) return;

        startRouteNavigation(state.navigationRoute);
        document.body.classList.add('is-navigation-following');
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

        closeRoutePicker();
        list.classList.add('hidden');
        searchPanel?.classList.add('hidden');
        profilePanel?.classList.add('hidden');
        sheet.classList.add('hidden');
        card.classList.add('hidden');
        pickPanel?.classList.add('hidden');
        document.body.classList.remove('is-sheet-open');
        document.body.classList.add('is-navigation-mode');
        setActiveNav('show-map');
        renderNavigationPanel();
    }

    function renderNavigationPanel() {
        document.querySelector('.navigation-panel')?.remove();
        if (!state.navigationSpot || !state.navigationRoute) return;

        const panel = document.createElement('section');
        panel.className = 'navigation-panel liquid-glass';
        panel.innerHTML = `
            <div class="navigation-panel__summary">
                <strong>${formatDuration(state.navigationRoute.durationSeconds)}</strong>
                <span>${formatDistance(state.navigationRoute.distanceMeters)}</span>
                <small>${escapeHtml(state.navigationSpot.title)}</small>
            </div>
            <button class="navigation-panel__drive" type="button" data-action="start-navigation">
                <span>Поехать</span>
                <small>к началу маршрута</small>
            </button>
            <button class="navigation-panel__stop" type="button" data-action="stop-navigation" aria-label="Завершить маршрут">×</button>
        `;
        document.body.append(panel);
        window.setTimeout(() => panel.classList.add('is-visible'), 20);
    }

    function stopNavigationMode() {
        document.body.classList.remove('is-navigation-mode');
        document.body.classList.remove('is-navigation-following');
        document.querySelector('.navigation-panel')?.remove();
        state.navigationSpot = null;
        state.navigationRoute = null;
        clearActiveRoute();
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
