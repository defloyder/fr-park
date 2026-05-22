import { importParkingSpots, updateParkingSpot } from './parking-api';

const STATUS_LABELS = {
    verified: 'Проверено',
    unverified: 'Не проверено',
    temporary: 'Временная',
    outdated: 'Неактуально',
};

let spots = [];
let selectedIds = new Set();

export function initAdminPanel() {
    const root = document.querySelector('[data-admin-app]');
    if (!root) return;

    const rows = root.querySelector('[data-admin-rows]');
    const search = root.querySelector('[data-admin-search]');
    const status = root.querySelector('[data-admin-status]');
    const visibility = root.querySelector('[data-admin-visibility]');
    const editor = root.querySelector('[data-admin-editor]');
    const editorTitle = root.querySelector('[data-admin-editor-title]');
    const message = root.querySelector('[data-admin-message]');
    const selectedCount = root.querySelector('[data-admin-selected-count]');
    const checkAll = root.querySelector('[data-admin-check-all]');
    const importForm = root.querySelector('#import-spots-form');
    const importMessage = root.querySelector('#import-message');

    root.addEventListener('click', async (event) => {
        const editButton = event.target.closest('[data-admin-edit]');
        const checkButton = event.target.closest('[data-admin-row-check]');
        const bulkStatus = event.target.closest('[data-admin-bulk]')?.dataset.adminBulk;

        if (editButton) fillEditor(findSpot(editButton.dataset.adminEdit));
        if (checkButton) toggleSelected(Number(checkButton.dataset.adminRowCheck));
        if (event.target.closest('[data-admin-refresh]')) await loadSpots();
        if (event.target.closest('[data-admin-export-selected]')) exportSelected();
        if (bulkStatus) await bulk('status', { availability_status: bulkStatus });
        if (event.target.closest('[data-admin-hide]')) await bulk('hide');
        if (event.target.closest('[data-admin-activate]')) await bulk('activate');
    });

    search?.addEventListener('input', render);
    status?.addEventListener('change', render);
    visibility?.addEventListener('change', render);
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
            photo_urls: editor.elements.photo_urls.value
                .split(',')
                .map((photo) => photo.trim())
                .filter(Boolean),
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

    loadSpots();

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

    function render() {
        const filtered = getFilteredSpots();
        rows.innerHTML = filtered.map((spot) => `
            <tr>
                <td><button class="export-check ${selectedIds.has(Number(spot.id)) ? 'is-checked' : ''}" type="button" data-admin-row-check="${spot.id}"><span></span></button></td>
                <td>
                    <strong>${escapeHtml(spot.title)}</strong>
                    <small>${escapeHtml(spot.address || 'Адрес не указан')}</small>
                </td>
                <td><em class="spot-list__status spot-list__status--${getStatus(spot)}">${STATUS_LABELS[getStatus(spot)]}</em></td>
                <td>${getPhotos(spot).length}</td>
                <td>${escapeHtml(spot.status)}</td>
                <td><button class="ghost-button" type="button" data-admin-edit="${spot.id}">Открыть</button></td>
            </tr>
        `).join('');

        selectedCount.textContent = `Выбрано: ${selectedIds.size}`;
        checkAll.checked = filtered.length > 0 && filtered.every((spot) => selectedIds.has(Number(spot.id)));
        updateStats();
    }

    function getFilteredSpots() {
        const query = search.value.trim().toLowerCase();
        return spots.filter((spot) => {
            const haystack = [spot.title, spot.address, spot.description, spot.access_instructions, spot.landmarks].filter(Boolean).join(' ').toLowerCase();
            return (!query || haystack.includes(query))
                && (!status.value || getStatus(spot) === status.value)
                && (!visibility.value || spot.status === visibility.value);
        });
    }

    function fillEditor(spot) {
        if (!spot) return;
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
        editor.elements.photo_urls.value = getPhotos(spot).join(', ');
        setMessage('');
    }

    async function bulk(action, extra = {}) {
        const ids = [...selectedIds];
        if (ids.length === 0) return;

        const response = await fetch('/aura-vault-7f3c/spots/bulk', {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
                'X-CSRF-TOKEN': document.querySelector('meta[name="csrf-token"]')?.getAttribute('content'),
            },
            body: JSON.stringify({ ids, action, ...extra }),
        });
        const data = await response.json();
        data.data?.forEach(upsert);
        selectedIds.clear();
        render();
    }

    function exportSelected() {
        const ids = [...selectedIds];
        if (ids.length === 0) return;
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
