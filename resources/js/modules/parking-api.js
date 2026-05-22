export async function fetchParkingSpots() {
    const response = await fetch('/api/parking-spots', {
        credentials: 'same-origin',
        headers: {
            Accept: 'application/json',
        },
    });

    if (!response.ok) {
        throw new Error('Failed to load parking spots');
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

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        const message = data?.message ?? 'Failed to create parking spot';
        const errors = data?.errors ?? {};
        throw Object.assign(new Error(message), { errors });
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

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        const message = data?.message ?? 'Failed to update parking spot';
        const errors = data?.errors ?? {};
        throw Object.assign(new Error(message), { errors });
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

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        const message = data?.message ?? 'Failed to upload photo';
        const errors = data?.errors ?? {};
        throw Object.assign(new Error(message), { errors });
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

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        const message = data?.message ?? 'Failed to import parking spots';
        const errors = data?.errors ?? {};
        throw Object.assign(new Error(message), { errors });
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

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        const message = data?.message ?? 'Failed to authenticate';
        const errors = data?.errors ?? {};
        throw Object.assign(new Error(message), { errors });
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

    const data = await response.json().catch(() => ({}));

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
