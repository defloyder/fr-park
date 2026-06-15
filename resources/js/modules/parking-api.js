// ---------------------------------------------------------------------------
// Encrypted session — один токен + AES-ключ на загрузку страницы.
// POST /api/session/init выдаёт токен (кладётся в X-Api-Token) и
// base64-ключ для расшифровки AES-256-GCM ответов.
// ---------------------------------------------------------------------------

let _sessionPromise = null;

function _getSession() {
    if (!_sessionPromise) {
        _sessionPromise = _initSession();
    }
    return _sessionPromise;
}

async function _initSession() {
    const res = await fetch('/api/session/init', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error('Failed to init API session');
    const { token, key } = await res.json();
    const cryptoKey = await crypto.subtle.importKey(
        'raw',
        _b64ToBuffer(key),
        { name: 'AES-GCM' },
        false,
        ['decrypt'],
    );
    return { token, cryptoKey };
}

async function _decrypt(payload, cryptoKey) {
    const iv   = _b64ToBuffer(payload.iv);
    const data = _b64ToBytes(payload.data);
    const tag  = _b64ToBytes(payload.tag);
    // SubtleCrypto ожидает: ciphertext || tag в одном буфере
    const combined = new Uint8Array(data.byteLength + tag.byteLength);
    combined.set(data, 0);
    combined.set(tag, data.byteLength);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, cryptoKey, combined);
    return JSON.parse(new TextDecoder().decode(plain));
}

function _b64ToBuffer(b64) {
    return _b64ToBytes(b64).buffer;
}

function _b64ToBytes(b64) {
    const bin = atob(b64);
    const buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    return buf;
}

// ---------------------------------------------------------------------------

export async function fetchParkingSpots() {
    const { token, cryptoKey } = await _getSession();

    const response = await fetch('/api/parking-spots', {
        credentials: 'same-origin',
        headers: {
            Accept: 'application/json',
            'X-Api-Token': token,
        },
    });

    if (!response.ok) {
        throw new Error('Failed to load parking spots');
    }

    const encrypted = await response.json();
    return _decrypt(encrypted, cryptoKey);
}

export async function fetchRoadDetails(bounds, { signal } = {}) {
    const params = new URLSearchParams({
        south: String(bounds.south),
        west: String(bounds.west),
        north: String(bounds.north),
        east: String(bounds.east),
    });
    const response = await fetch(`/api/map/road-details?${params}`, {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
        signal,
    });

    if (!response.ok) {
        return {
            type: 'FeatureCollection',
            features: [],
            unavailable: true,
        };
    }

    return response.json();
}

export async function createParkingSpot(payload) {
    const response = await fetch('/api/parking-spots', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'X-CSRF-TOKEN': document
                .querySelector('meta[name="csrf-token"]')
                ?.getAttribute('content'),
        },
        body: JSON.stringify(payload),
    });

    const data = await readJson(response);

    if (!response.ok) {
        throwApiError(response, data, 'Failed to create parking spot');
    }

    return data;
}

export async function updateParkingSpot(id, payload) {
    const response = await fetch(`/api/parking-spots/${id}`, {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'X-CSRF-TOKEN': document
                .querySelector('meta[name="csrf-token"]')
                ?.getAttribute('content'),
        },
        body: JSON.stringify(payload),
    });

    const data = await readJson(response);

    if (!response.ok) {
        throwApiError(response, data, 'Failed to update parking spot');
    }

    return data;
}

export async function uploadParkingPhoto(file) {
    const formData = new FormData();
    formData.append('photo', file, getPhotoUploadFileName(file));

    const response = await fetch('/api/parking-spots/photo', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
            Accept: 'application/json',
            'X-CSRF-TOKEN': document
                .querySelector('meta[name="csrf-token"]')
                ?.getAttribute('content'),
        },
        body: formData,
    });

    const data = await readJson(response);

    if (!response.ok) {
        throwApiError(response, data, 'Failed to upload photo');
    }

    return data;
}

export function isUploadableParkingPhoto(file) {
    if (!file) return false;
    if (file.type?.startsWith('image/')) return true;
    if (!file.type && file.size > 0) return true;

    return /\.(jpe?g|png|webp|heic|heif|avif)$/i.test(file.name || '');
}

export async function prepareParkingPhotoForUpload(file) {
    if (!shouldCompressParkingPhoto(file)) return file;

    try {
        return await compressParkingPhoto(file);
    } catch (error) {
        if (file.size > 12 * 1024 * 1024) {
            throw new Error('Не удалось уменьшить большое фото. Выберите снимок до 12 МБ или отключите максимальное качество камеры.');
        }

        return file;
    }
}

function shouldCompressParkingPhoto(file) {
    const type = String(file?.type || '').toLowerCase();
    const name = String(file?.name || '').toLowerCase();

    if (!file || file.size < 900 * 1024) return false;
    if (/\.(heic|heif|avif)$/i.test(name)) return false;

    return ['image/jpeg', 'image/jpg', 'image/pjpeg', 'image/png', 'image/x-png', 'image/webp', ''].includes(type)
        || /\.(jpe?g|png|webp)$/i.test(name);
}

async function compressParkingPhoto(file) {
    const source = await decodeReducedPhoto(file);
    const maxSide = 1600;
    const ratio = Math.min(1, maxSide / Math.max(source.width, source.height));
    const width = Math.max(1, Math.round(source.width * ratio));
    const height = Math.max(1, Math.round(source.height * ratio));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext('2d', { alpha: false });
    if (!context) {
        source.close();
        throw new Error('Photo canvas is unavailable');
    }

    try {
        context.drawImage(source.image, 0, 0, width, height);
    } finally {
        source.close();
    }

    const blob = await new Promise((resolve, reject) => {
        canvas.toBlob((result) => {
            result ? resolve(result) : reject(new Error('Photo compression failed'));
        }, 'image/jpeg', 0.76);
    });

    canvas.width = 1;
    canvas.height = 1;

    if (!blob || (blob.size >= file.size && file.size <= 8 * 1024 * 1024)) return file;

    return new File([blob], getCompressedParkingPhotoName(file), {
        type: 'image/jpeg',
        lastModified: Date.now(),
    });
}

async function decodeReducedPhoto(file) {
    if (typeof createImageBitmap === 'function') {
        const options = {
            imageOrientation: 'from-image',
            resizeWidth: 1600,
            resizeQuality: 'high',
        };

        try {
            const bitmap = await createImageBitmap(file, options);
            return {
                image: bitmap,
                width: bitmap.width,
                height: bitmap.height,
                close: () => bitmap.close?.(),
            };
        } catch {
            // Older mobile browsers may not support resize options.
        }
    }

    const objectUrl = URL.createObjectURL(file);
    const image = new Image();

    try {
        image.decoding = 'async';
        image.src = objectUrl;
        if (typeof image.decode === 'function') {
            await image.decode();
        } else {
            await new Promise((resolve, reject) => {
                image.onload = resolve;
                image.onerror = reject;
            });
        }

        return {
            image,
            width: image.naturalWidth,
            height: image.naturalHeight,
            close: () => URL.revokeObjectURL(objectUrl),
        };
    } catch (error) {
        URL.revokeObjectURL(objectUrl);
        throw error;
    }
}

function getCompressedParkingPhotoName(file) {
    const name = String(file?.name || '').trim().replace(/\.[^.]+$/, '');
    return `${name || 'phone-photo'}.jpg`;
}

function getPhotoUploadFileName(file) {
    const name = String(file?.name || '').trim();

    if (/\.(jpe?g|png|webp|heic|heif|avif)$/i.test(name)) {
        return name;
    }

    const extensionByType = {
        'image/jpeg': 'jpg',
        'image/jpg': 'jpg',
        'image/pjpeg': 'jpg',
        'image/png': 'png',
        'image/x-png': 'png',
        'image/webp': 'webp',
        'image/heic': 'heic',
        'image/heif': 'heif',
        'image/heic-sequence': 'heic',
        'image/heif-sequence': 'heif',
        'image/avif': 'avif',
    };
    const extension = extensionByType[String(file?.type || '').toLowerCase()];
    const baseName = name.replace(/\.[^.]+$/, '') || 'phone-photo';

    return extension ? `${baseName}.${extension}` : baseName;
}

export async function importParkingSpots({ file = null, text = '' }) {
    const formData = new FormData();

    if (file) {
        formData.append('json_file', file);
    }

    if (text.trim()) {
        formData.append('json_text', text.trim());
    }

    const response = await fetch('/api/parking-spots/import', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
            Accept: 'application/json',
            'X-CSRF-TOKEN': document
                .querySelector('meta[name="csrf-token"]')
                ?.getAttribute('content'),
        },
        body: formData,
    });

    const data = await readJson(response);

    if (!response.ok) {
        throwApiError(response, data, 'Failed to import parking spots');
    }

    return data;
}

export function getParkingSpotsExportUrl(ids = []) {
    const query = new URLSearchParams();

    if (ids.length > 0) {
        query.set('ids', ids.join(','));
    }

    const suffix = query.toString();

    return `/api/parking-spots/export${suffix ? `?${suffix}` : ''}`;
}

export async function deleteParkingSpot(id) {
    const response = await fetch(`/api/parking-spots/${id}`, {
        method: 'DELETE',
        credentials: 'same-origin',
        headers: {
            Accept: 'application/json',
            'X-CSRF-TOKEN': document
                .querySelector('meta[name="csrf-token"]')
                ?.getAttribute('content'),
        },
    });

    if (!response.ok) {
        throw new Error('Failed to delete parking spot');
    }
}

export async function reverseGeocode(latitude, longitude) {
    const query = new URLSearchParams({
        latitude,
        longitude,
    });
    const response = await fetch(`/api/geocode/reverse?${query.toString()}`, {
        credentials: 'same-origin',
        headers: {
            Accept: 'application/json',
        },
    });

    if (!response.ok) {
        throw new Error('Failed to reverse geocode coordinates');
    }

    return response.json();
}

export async function fetchDrivingRoute(from, to) {
    const query = new URLSearchParams({
        from_latitude: from.latitude,
        from_longitude: from.longitude,
        to_latitude: to.latitude,
        to_longitude: to.longitude,
    });
    const response = await fetch(`/api/routes/driving?${query.toString()}`, {
        credentials: 'same-origin',
        headers: {
            Accept: 'application/json',
        },
    });

    if (!response.ok) {
        throw new Error('Failed to build driving route');
    }

    return response.json();
}

export async function fetchRouteSpeedCameras(coordinates) {
    const response = await fetch('/api/navigation/speed-cameras', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            'X-CSRF-TOKEN': document.querySelector('meta[name="csrf-token"]')?.content ?? '',
        },
        body: JSON.stringify({ coordinates }),
    });

    if (!response.ok) {
        throw new Error('Failed to load speed cameras');
    }

    return response.json();
}

export async function fetchAccountSession() {
    const response = await fetch('/account/session', {
        credentials: 'same-origin',
        headers: {
            Accept: 'application/json',
        },
    });

    if (!response.ok) {
        throw new Error('Failed to load account session');
    }

    return syncCsrfToken(await response.json());
}

export async function submitAuth(mode, payload) {
    const response = await fetch(`/account/${mode}`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'X-CSRF-TOKEN': document
                .querySelector('meta[name="csrf-token"]')
                ?.getAttribute('content'),
        },
        body: JSON.stringify(payload),
    });

    const data = await readJson(response);

    if (!response.ok) {
        throwApiError(response, data, 'Failed to authenticate');
    }

    return syncCsrfToken(data);
}

export async function logoutAccount() {
    const response = await fetch('/account/logout', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
            Accept: 'application/json',
            'X-CSRF-TOKEN': document
                .querySelector('meta[name="csrf-token"]')
                ?.getAttribute('content'),
        },
    });

    if (!response.ok) {
        throw new Error('Failed to logout');
    }

    return syncCsrfToken(await response.json());
}

export async function fetchFavorites() {
    const response = await fetch('/account/favorites', {
        credentials: 'same-origin',
        headers: {
            Accept: 'application/json',
        },
    });

    if (!response.ok) {
        throw new Error('Failed to load favorites');
    }

    return response.json();
}

export async function toggleFavoriteSpot(id) {
    const response = await fetch(`/account/favorites/${id}/toggle`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
            Accept: 'application/json',
            'X-CSRF-TOKEN': document
                .querySelector('meta[name="csrf-token"]')
                ?.getAttribute('content'),
        },
    });

    const data = await readJson(response);

    if (!response.ok) {
        throw new Error(data?.message ?? 'Failed to toggle favorite');
    }

    return data;
}

export async function createPersonalPlace(payload) {
    return sendPersonalPlaceRequest('/account/personal-places', 'POST', payload);
}

export async function syncPersonalPlaces(places) {
    return sendPersonalPlaceRequest('/account/personal-places/sync', 'POST', { places });
}

export async function deletePersonalPlace(id) {
    return sendPersonalPlaceRequest(`/account/personal-places/${encodeURIComponent(id)}`, 'DELETE');
}

async function sendPersonalPlaceRequest(url, method, payload = null) {
    const response = await fetch(url, {
        method,
        credentials: 'same-origin',
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            'X-CSRF-TOKEN': document
                .querySelector('meta[name="csrf-token"]')
                ?.getAttribute('content'),
        },
        body: payload ? JSON.stringify(payload) : undefined,
    });
    const data = await readJson(response);

    if (!response.ok) {
        throwApiError(response, data, 'Failed to update personal places');
    }

    return data;
}

function syncCsrfToken(data) {
    if (data?.csrf_token) {
        document
            .querySelector('meta[name="csrf-token"]')
            ?.setAttribute('content', data.csrf_token);
    }

    return data;
}

async function readJson(response) {
    return response.json().catch(() => ({}));
}

function throwApiError(response, data, fallback) {
    const messages = {
        401: 'Войдите в профиль и попробуйте снова.',
        403: 'Недостаточно прав для этого действия.',
        413: 'Фото слишком большое для загрузки. Попробуйте уменьшить его или выбрать другое.',
        419: 'Сессия истекла или браузер не принял cookie. Обновите страницу и попробуйте снова.',
        422: 'Проверьте заполненные поля.',
    };
    const message = data?.message ?? messages[response.status] ?? fallback;
    const errors = data?.errors ?? {};

    throw Object.assign(new Error(message), { errors, status: response.status });
}
