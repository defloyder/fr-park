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
    formData.append('photo', file);

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
        419: 'Сессия истекла или браузер не принял cookie. Обновите страницу и попробуйте снова.',
        422: 'Проверьте заполненные поля.',
    };
    const message = data?.message ?? messages[response.status] ?? fallback;
    const errors = data?.errors ?? {};

    throw Object.assign(new Error(message), { errors, status: response.status });
}
