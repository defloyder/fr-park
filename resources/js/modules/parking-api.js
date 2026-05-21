export async function fetchParkingSpots() {
    const response = await fetch('/api/parking-spots', {
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

export async function deleteParkingSpot(id) {
    const response = await fetch(`/api/parking-spots/${id}`, {
        method: 'DELETE',
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

export async function fetchAccountSession() {
    const response = await fetch('/account/session', {
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
