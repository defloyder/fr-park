import {
    csrfFetch,
    deleteParkingSpot,
    importParkingSpots,
    isUploadableParkingPhoto,
    prepareParkingPhotoForUpload,
    updateParkingSpot,
    uploadParkingPhoto,
} from './parking-api';

const STATUS_LABELS = {
    verified: 'Проверено',
    unverified: 'Не проверено',
    temporary: 'Временная',
    outdated: 'Неактуально',
};
const ADMIN_THEME_STORAGE_KEY = 'auralith-admin-theme';

let spots = [];
let users = [];
let selectedIds = new Set();
let editorPhotos = [];

export function initAdminPanel() {
    const root = document.querySelector('[data-admin-app]');
    if (!root) return;

    initAdminTheme(root);

    const rows = root.querySelector('[data-admin-rows]');
    const search = root.querySelector('[data-admin-search]');
    const status = root.querySelector('[data-admin-status]');
    const editor = root.querySelector('[data-admin-editor]');
    const emptyEditor = root.querySelector('[data-admin-empty-editor]');
    const editorTitle = root.querySelector('[data-admin-editor-title]');
    const message = root.querySelector('[data-admin-message]');
    const selectedCount = root.querySelector('[data-admin-selected-count]');
    const checkAll = root.querySelector('[data-admin-check-all]');
    const importForm = root.querySelector('#import-spots-form');
    const importMessage = root.querySelector('#import-message');
    const usersList = root.querySelector('[data-admin-users]');
    const mapModal = root.querySelector('[data-admin-map-modal]');
    const photoDropzone = root.querySelector('[data-admin-photo-dropzone]');
    const photoInput = root.querySelector('[data-admin-photo-input]');
    const photoPreview = root.querySelector('[data-admin-photo-preview]');
    const metricsSummary = root.querySelector('[data-admin-metrics-summary]');
    const metricsDetails = root.querySelector('[data-admin-metrics-details]');

    root.addEventListener('click', async (event) => {
        const editButton = event.target.closest('[data-admin-edit]');
        const deleteButton = event.target.closest('[data-admin-delete]');
        const checkButton = event.target.closest('[data-admin-row-check]');
        const bulkStatus = event.target.closest('[data-admin-bulk]')?.dataset.adminBulk;
        const userAdminButton = event.target.closest('[data-admin-user]');
        const themeButton = event.target.closest('[data-admin-theme-option]');

        if (editButton) fillEditor(findSpot(editButton.dataset.adminEdit));
        if (deleteButton) await deleteSingleSpot(Number(deleteButton.dataset.adminDelete));
        if (checkButton) toggleSelected(Number(checkButton.dataset.adminRowCheck));
        if (themeButton) setAdminTheme(root, themeButton.dataset.adminThemeOption, true);
        if (event.target.closest('[data-admin-refresh]')) await loadSpots();
        if (event.target.closest('[data-admin-users-refresh]')) await loadUsers();
        if (event.target.closest('[data-admin-metrics-refresh]')) await loadMetrics();
        if (event.target.closest('[data-admin-export-selected]')) exportSelected();
        if (event.target.closest('[data-admin-open-map]')) openMapModal();
        if (event.target.closest('[data-admin-open-users]')) {
            root.querySelector('.admin-users-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        if (event.target.closest('[data-admin-open-metrics]')) {
            root.querySelector('.admin-metrics-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        if (event.target.closest('[data-admin-close-map]')) closeMapModal();
        if (event.target === mapModal) closeMapModal();
        if (userAdminButton) await toggleUserAdmin(Number(userAdminButton.dataset.adminUser), userAdminButton.dataset.adminRole === 'true');
        if (bulkStatus) await bulk('status', { availability_status: bulkStatus });
        if (event.target.closest('[data-admin-hide]')) await bulk('hide');
        if (event.target.closest('[data-admin-activate]')) await bulk('activate');
    });

    search?.addEventListener('input', render);
    status?.addEventListener('change', render);
    checkAll?.addEventListener('change', () => {
        selectedIds = checkAll.checked ? new Set(getFilteredSpots().map((spot) => Number(spot.id))) : new Set();
        render();
    });

    editor?.addEventListener('submit', async (event) => {
        event.preventDefault();
        const id = Number(editor.elements.id.value);
        if (!id) return;

        setMessage('');
        const payload = {
            title: editor.elements.title.value.trim(),
            address: editor.elements.address.value.trim(),
            availability_status: editor.elements.availability_status.value,
            latitude: Number(editor.elements.latitude.value),
            longitude: Number(editor.elements.longitude.value),
            description: editor.elements.description.value.trim(),
            access_instructions: editor.elements.access_instructions.value.trim(),
            landmarks: editor.elements.landmarks.value.trim(),
            photo_urls: getEditorPhotos(),
        };
        payload.photo_url = payload.photo_urls[0] ?? '';

        try {
            const response = await updateParkingSpot(id, payload);
            upsert(response.data);
            fillEditor(response.data);
            setMessage('Сохранено.', false);
        } catch (error) {
            setMessage(error.message || 'Не удалось сохранить.', true);
        }
    });

    importForm?.addEventListener('submit', async (event) => {
        event.preventDefault();
        importMessage.classList.add('hidden');

        try {
            const response = await importParkingSpots({
                file: importForm.elements.json_file?.files?.[0] ?? null,
                text: importForm.elements.json_text?.value ?? '',
            });
            response.data?.forEach(upsert);
            importForm.reset();
            importMessage.textContent = `Добавлено: ${response.created_count}. Пропущено: ${response.skipped_count}. Ошибок: ${response.error_count}.`;
            importMessage.classList.remove('hidden', 'is-error');
            importMessage.classList.add('is-success');
            render();
        } catch (error) {
            importMessage.textContent = error.message || 'Не удалось импортировать.';
            importMessage.classList.remove('hidden', 'is-success');
            importMessage.classList.add('is-error');
        }
    });

    photoDropzone?.addEventListener('click', () => photoInput?.click());
    photoDropzone?.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            photoInput?.click();
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
        await uploadEditorPhotos([...event.dataTransfer.files]);
    });
    photoInput?.addEventListener('change', async () => {
        await uploadEditorPhotos([...photoInput.files]);
        photoInput.value = '';
    });

    loadSpots();
    loadUsers();
    loadMetrics();

    async function loadSpots() {
        const response = await fetch('/aura-vault-7f3c/spots', {
            credentials: 'same-origin',
            headers: { Accept: 'application/json' },
        });
        const data = await response.json();
        spots = data.data ?? [];
        selectedIds.clear();
        render();
    }

    async function loadUsers() {
        const response = await fetch('/aura-vault-7f3c/users', {
            credentials: 'same-origin',
            headers: { Accept: 'application/json' },
        });
        const data = await response.json();
        users = data.data ?? [];
        renderUsers();
    }

    async function loadMetrics() {
        if (!metricsSummary || !metricsDetails) return;

        try {
            const response = await fetch('/aura-vault-7f3c/metrics', {
                credentials: 'same-origin',
                headers: { Accept: 'application/json' },
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            renderMetrics((await response.json()).data ?? {});
        } catch (error) {
            renderMetrics({
                cache: {
                    default_store: 'endpoint',
                    session_driver: 'unknown',
                    queue_connection: 'unknown',
                    redis: {
                        available: false,
                        error: error?.message || 'request failed',
                    },
                },
                map: {
                    last_hour: { events: 0, tile_failures_observed: 0 },
                    last_day: { events: 0, tile_failures_observed: 0 },
                    latest: [],
                },
            });
            metricsDetails.innerHTML = '<p class="admin-metrics-empty">Endpoint метрик не ответил. Проверь route/cache на сервере и повтори обновление.</p>';
        }
    }

    function renderMetrics(metrics) {
        const cache = metrics.cache ?? {};
        const redis = cache.redis ?? {};
        const hour = metrics.map?.last_hour ?? {};
        const day = metrics.map?.last_day ?? {};
        const latest = metrics.map?.latest ?? [];
        const cacheUsesRedis = cache.default_store === 'redis'
            && cache.session_driver === 'redis'
            && cache.queue_connection === 'redis';

        metricsSummary.innerHTML = `
            <article class="${cacheUsesRedis ? 'is-ok' : 'is-warn'}">
                <span>Cache</span>
                <strong>${escapeHtml(cache.default_store || 'unknown')}</strong>
                <small>sessions: ${escapeHtml(cache.session_driver || 'unknown')} · queue: ${escapeHtml(cache.queue_connection || 'unknown')}</small>
            </article>
            <article class="${redis.available ? 'is-ok' : 'is-bad'}">
                <span>Redis</span>
                <strong>${redis.available ? 'OK' : 'Fail'}</strong>
                <small>${redis.available ? `${Number(redis.latency_ms || 0)} ms` : escapeHtml(redis.error || 'unavailable')}</small>
            </article>
            <article>
                <span>События / час</span>
                <strong>${Number(hour.events || 0)}</strong>
                <small>сутки: ${Number(day.events || 0)}</small>
            </article>
            <article class="${Number(hour.tile_failures_observed || 0) > 0 ? 'is-warn' : ''}">
                <span>Ошибки тайлов / час</span>
                <strong>${Number(hour.tile_failures_observed || 0)}</strong>
                <small>сутки: ${Number(day.tile_failures_observed || 0)}</small>
            </article>
            <article>
                <span>Карта готова</span>
                <strong>${formatMs(hour.avg_map_ready_ms)}</strong>
                <small>среднее за час</small>
            </article>
            <article>
                <span>АЗС full</span>
                <strong>${formatMs(hour.avg_fuel_request_ms)}</strong>
                <small>среднее за час</small>
            </article>
        `;

        const reasons = Object.entries(hour.reasons ?? {})
            .sort((first, second) => Number(second[1]) - Number(first[1]))
            .map(([reason, count]) => `<span>${escapeHtml(reason)}: ${Number(count)}</span>`)
            .join('');

        metricsDetails.innerHTML = `
            <section>
                <h3>Причины за час</h3>
                <div class="admin-metrics-tags">${reasons || '<span>Нет событий</span>'}</div>
            </section>
            <section>
                <h3>Последние события</h3>
                ${latest.length > 0 ? `
                    <div class="admin-metrics-events">
                        ${latest.map((event) => `
                            <article>
                                <strong>${escapeHtml(event.reason || 'unknown')}</strong>
                                <span>${formatDateTime(event.at)} · ${escapeHtml(event.viewport || '')} · ${escapeHtml(event.connection || '')}</span>
                                <small>${escapeHtml(event.user_agent || '')}</small>
                            </article>
                        `).join('')}
                    </div>
                ` : '<p class="admin-metrics-empty">Проблемных событий пока нет.</p>'}
            </section>
        `;
    }

    function render() {
        const filtered = getFilteredSpots();
        rows.innerHTML = filtered.map((spot) => `
            <tr>
                <td class="admin-table__select" data-label="Выбрать"><button class="export-check ${selectedIds.has(Number(spot.id)) ? 'is-checked' : ''}" type="button" data-admin-row-check="${spot.id}" aria-label="Выбрать точку «${escapeAttribute(spot.title)}»"><span></span></button></td>
                <td class="admin-table__primary" data-label="Точка">
                    <strong>${escapeHtml(spot.title)}</strong>
                    <small>${escapeHtml(spot.address || 'Адрес не указан')}</small>
                </td>
                <td data-label="Статус"><em class="spot-list__status spot-list__status--${getStatus(spot)}">${STATUS_LABELS[getStatus(spot)]}</em></td>
                <td data-label="Фото">${getPhotos(spot).length}</td>
                <td class="admin-table__actions" data-label="Действия">
                    <div class="admin-row-actions">
                        <button class="ghost-button admin-row-action" type="button" data-admin-edit="${spot.id}">Редактировать</button>
                        <button class="danger-button admin-row-action" type="button" data-admin-delete="${spot.id}">Удалить</button>
                    </div>
                </td>
            </tr>
        `).join('');

        selectedCount.textContent = `Выбрано: ${selectedIds.size}`;
        checkAll.checked = filtered.length > 0 && filtered.every((spot) => selectedIds.has(Number(spot.id)));
        updateStats();
    }

    function renderUsers() {
        usersList.innerHTML = users.map((user) => `
            <tr>
                <td class="admin-table__primary" data-label="Пользователь"><strong>${escapeHtml(user.name)}</strong></td>
                <td data-label="Email"><small>${escapeHtml(user.email)}</small></td>
                <td data-label="Роль"><em class="admin-role-badge ${user.is_admin ? 'is-admin' : ''}">${user.is_root_admin ? 'Главный админ' : (user.is_admin ? 'Админ' : 'Пользователь')}</em></td>
                <td data-label="Регистрация"><small>${formatDate(user.created_at)}</small></td>
                <td class="admin-table__actions" data-label="Действия">
                    <button class="ghost-button admin-row-action ${user.is_admin ? 'is-active' : ''}" type="button" data-admin-user="${user.id}" data-admin-role="${user.is_admin ? 'false' : 'true'}" ${user.is_root_admin ? 'disabled' : ''}>
                        ${user.is_root_admin ? 'Защищен' : (user.is_admin ? 'Снять роль' : 'Назначить админом')}
                    </button>
                </td>
            </tr>
        `).join('');
    }

    function getFilteredSpots() {
        const query = search.value.trim().toLowerCase();
        return spots.filter((spot) => {
            const haystack = [spot.title, spot.address, spot.description, spot.access_instructions, spot.landmarks].filter(Boolean).join(' ').toLowerCase();
            return (!query || haystack.includes(query))
                && (!status.value || getStatus(spot) === status.value);
        });
    }

    function fillEditor(spot) {
        if (!spot) return;
        emptyEditor?.classList.add('hidden');
        editor?.classList.remove('hidden');
        editorTitle.textContent = spot.title;
        editor.elements.id.value = spot.id;
        editor.elements.title.value = spot.title ?? '';
        editor.elements.address.value = spot.address ?? '';
        editor.elements.availability_status.value = getStatus(spot);
        editor.elements.latitude.value = spot.latitude;
        editor.elements.longitude.value = spot.longitude;
        editor.elements.description.value = spot.description ?? '';
        editor.elements.access_instructions.value = spot.access_instructions ?? '';
        editor.elements.landmarks.value = spot.landmarks ?? '';
        editorPhotos = getPhotos(spot);
        editor.elements.photo_urls.value = editorPhotos.join(', ');
        renderEditorPhotos();
        setMessage('');

        if (window.matchMedia('(max-width: 1199px)').matches) {
            root.querySelector('.admin-editor')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }

    async function uploadEditorPhotos(files) {
        const images = files.filter((file) => isUploadableParkingPhoto(file));
        if (images.length === 0) return;
        if (images.some((file) => file.size > 50 * 1024 * 1024)) {
            setMessage('Фото слишком большое. Максимальный размер исходного файла — 50 МБ.', true);
            return;
        }

        photoDropzone?.classList.add('is-uploading');
        setMessage('Загружаю фото...');

        try {
            const uploadedUrls = [];

            for (const [index, file] of images.entries()) {
                setMessage(images.length > 1 ? `Обрабатываю фото ${index + 1} из ${images.length}...` : 'Обрабатываю фото...');
                const preparedFile = await prepareParkingPhotoForUpload(file);
                const uploaded = await uploadParkingPhoto(preparedFile);
                if (uploaded.url) uploadedUrls.push(uploaded.url);
            }

            editorPhotos = [...new Set([...editorPhotos, ...uploadedUrls])];
            editor.elements.photo_urls.value = editorPhotos.join(', ');
            renderEditorPhotos();
            setMessage('Фото добавлены.', false);
        } catch (error) {
            setMessage(error.message || 'Не удалось загрузить фото.', true);
        } finally {
            photoDropzone?.classList.remove('is-uploading');
        }
    }

    function renderEditorPhotos() {
        if (!photoPreview) return;

        photoPreview.innerHTML = editorPhotos.map((photo, index) => `
            <article class="admin-photo-preview">
                <img src="${escapeAttribute(photo)}" alt="">
                <button type="button" data-admin-remove-photo="${index}" aria-label="Удалить фото">×</button>
            </article>
        `).join('');

        photoPreview.querySelectorAll('[data-admin-remove-photo]').forEach((button) => {
            button.addEventListener('click', () => {
                editorPhotos.splice(Number(button.dataset.adminRemovePhoto), 1);
                editor.elements.photo_urls.value = editorPhotos.join(', ');
                renderEditorPhotos();
            });
        });

        photoPreview.querySelectorAll('.admin-photo-preview img').forEach((image, index) => {
            image.addEventListener('error', () => {
                editorPhotos.splice(index, 1);
                editor.elements.photo_urls.value = editorPhotos.join(', ');
                renderEditorPhotos();
                setMessage('Недоступная фотография удалена из формы.', true);
            }, { once: true });
        });
    }

    function getEditorPhotos() {
        const manualPhotos = editor.elements.photo_urls.value
            .split(',')
            .map((photo) => photo.trim())
            .filter(Boolean);

        return [...new Set([...editorPhotos, ...manualPhotos])];
    }

    async function bulk(action, extra = {}) {
        const ids = [...selectedIds];
        if (ids.length === 0) {
            window.alert('Сначала выберите одну или несколько точек.');
            return;
        }

        const response = await csrfFetch('/aura-vault-7f3c/spots/bulk', () => ({
            method: 'POST',
            credentials: 'same-origin',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
            },
            body: JSON.stringify({ ids, action, ...extra }),
        }));
        const data = await response.json();
        data.data?.forEach(upsert);
        selectedIds.clear();
        render();
    }

    async function toggleUserAdmin(id, isAdmin) {
        const response = await csrfFetch(`/aura-vault-7f3c/users/${id}/admin`, () => ({
            method: 'PATCH',
            credentials: 'same-origin',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
            },
            body: JSON.stringify({ is_admin: isAdmin }),
        }));
        const data = await response.json();

        if (!response.ok) {
            window.alert(data.message || 'Не удалось обновить роль.');
            return;
        }

        users = users.map((user) => (Number(user.id) === Number(id) ? data.data : user));
        renderUsers();
    }

    async function deleteSingleSpot(id) {
        if (!id || !window.confirm('Удалить эту точку с карты?')) return;

        try {
            await deleteParkingSpot(id);
            spots = spots.filter((spot) => Number(spot.id) !== Number(id));
            selectedIds.delete(id);
            if (Number(editor?.elements.id?.value) === Number(id)) {
                editor?.classList.add('hidden');
                emptyEditor?.classList.remove('hidden');
                editorPhotos = [];
            }
            render();
            setMessage('Точка удалена.', false);
        } catch (error) {
            setMessage(error.message || 'Не удалось удалить точку.', true);
        }
    }

    function openMapModal() {
        mapModal?.classList.remove('hidden');
    }

    function closeMapModal() {
        mapModal?.classList.add('hidden');
    }

    function exportSelected() {
        const ids = [...selectedIds];
        if (ids.length === 0) {
            window.alert('Сначала выберите точки для экспорта.');
            return;
        }
        window.location.href = `/api/parking-spots/export?ids=${ids.join(',')}`;
    }

    function toggleSelected(id) {
        selectedIds.has(id) ? selectedIds.delete(id) : selectedIds.add(id);
        render();
    }

    function upsert(spot) {
        spots = spots.some((item) => Number(item.id) === Number(spot.id))
            ? spots.map((item) => (Number(item.id) === Number(spot.id) ? spot : item))
            : [spot, ...spots];
    }

    function updateStats() {
        root.querySelector('[data-admin-stat="total"]').textContent = spots.length;
        root.querySelector('[data-admin-stat="verified"]').textContent = spots.filter((spot) => getStatus(spot) === 'verified').length;
        root.querySelector('[data-admin-stat="photos"]').textContent = spots.filter((spot) => getPhotos(spot).length > 0).length;
    }

    function setMessage(text, isError = false) {
        message.textContent = text;
        message.classList.toggle('hidden', !text);
        message.classList.toggle('is-error', isError);
        message.classList.toggle('is-success', Boolean(text) && !isError);
    }
}

function initAdminTheme(root) {
    let savedTheme = null;

    try {
        savedTheme = window.localStorage?.getItem(ADMIN_THEME_STORAGE_KEY);
    } catch {
        // Storage can be unavailable in strict privacy modes.
    }

    const systemTheme = window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    setAdminTheme(root, savedTheme === 'light' || savedTheme === 'dark' ? savedTheme : systemTheme);
}

function setAdminTheme(root, theme, persist = false) {
    const nextTheme = theme === 'dark' ? 'dark' : 'light';
    root.dataset.adminTheme = nextTheme;
    document.documentElement.style.colorScheme = nextTheme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute(
        'content',
        nextTheme === 'dark' ? '#07111f' : '#eaf4fa',
    );

    root.querySelectorAll('[data-admin-theme-option]').forEach((button) => {
        const isActive = button.dataset.adminThemeOption === nextTheme;
        button.classList.toggle('is-active', isActive);
        button.setAttribute('aria-pressed', String(isActive));
    });

    if (!persist) return;

    try {
        window.localStorage?.setItem(ADMIN_THEME_STORAGE_KEY, nextTheme);
    } catch {
        // The selected theme still applies for the current page.
    }
}

function findSpot(id) {
    return spots.find((spot) => Number(spot.id) === Number(id));
}

function getStatus(spot) {
    return spot.availability_status || (spot.is_verified ? 'verified' : 'unverified');
}

function getPhotos(spot) {
    const photos = Array.isArray(spot.photo_urls) ? spot.photo_urls : [];
    return photos.length > 0 ? photos.filter(Boolean) : (spot.photo_url ? [spot.photo_url] : []);
}

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;',
    }[char]));
}

function escapeAttribute(value) {
    return escapeHtml(value).replace(/`/g, '&#096;');
}

function formatDate(value) {
    if (!value) return '—';

    return new Intl.DateTimeFormat('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
    }).format(new Date(value));
}

function formatDateTime(value) {
    if (!value) return '—';

    return new Intl.DateTimeFormat('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    }).format(new Date(value));
}

function formatMs(value) {
    const milliseconds = Number(value);

    if (!Number.isFinite(milliseconds) || milliseconds <= 0) {
        return '—';
    }

    return milliseconds >= 1000
        ? `${(milliseconds / 1000).toFixed(1)}s`
        : `${Math.round(milliseconds)}ms`;
}
