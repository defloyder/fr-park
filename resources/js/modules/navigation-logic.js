export const DEFAULT_PASSED_CAMERA_DISTANCE_METERS = 25;
export const COMPASS_HEADING_MAX_AGE_MS = 2500;

export function shouldRecenterNavigationFromLocate({ isNavigationMode = false, hasRoute = false } = {}) {
    return Boolean(isNavigationMode && hasRoute);
}

export function shouldFollowNavigationPosition({
    isNavigationFollowing = false,
    isNavigationDetached = false,
    hasRoute = false,
    hasLocation = false,
} = {}) {
    return Boolean(isNavigationFollowing && !isNavigationDetached && hasRoute && hasLocation);
}

export function shouldFollowUserLocation({
    isUserLocationFollowing = false,
    isNavigationMode = false,
    hasLocation = false,
} = {}) {
    return Boolean(isUserLocationFollowing && !isNavigationMode && hasLocation);
}

export function isManualMapInteraction(event, isNavigationFollowing = false) {
    return Boolean(isNavigationFollowing && event?.originalEvent);
}

export function normalizeCompassHeading(event, screenAngle = 0) {
    const webkitHeading = Number(event?.webkitCompassHeading);

    if (Number.isFinite(webkitHeading) && webkitHeading >= 0) {
        return normalizeDegrees(webkitHeading);
    }

    const absoluteHeading = Number(event?.absolute === true ? event?.alpha : Number.NaN);

    if (Number.isFinite(absoluteHeading)) {
        return normalizeDegrees(360 - absoluteHeading + Number(screenAngle || 0));
    }

    const fallbackAlpha = Number(event?.alpha);

    return Number.isFinite(fallbackAlpha)
        ? normalizeDegrees(360 - fallbackAlpha + Number(screenAngle || 0))
        : null;
}

export function getCompassEventPriority(event) {
    if (Number.isFinite(Number(event?.webkitCompassHeading))) {
        return 2;
    }

    return event?.absolute === true ? 2 : 1;
}

export function smoothCompassHeading(
    previousHeading,
    nextHeading,
    { smoothing = 0.22, deadzoneDegrees = 1.2, maxStepDegrees = 24 } = {},
) {
    const next = Number(nextHeading);

    if (!Number.isFinite(next)) {
        return Number.isFinite(Number(previousHeading)) ? normalizeDegrees(previousHeading) : null;
    }

    if (previousHeading === null || previousHeading === undefined || previousHeading === '') {
        return normalizeDegrees(next);
    }

    const previous = Number(previousHeading);

    if (!Number.isFinite(previous)) {
        return normalizeDegrees(next);
    }

    const delta = getShortestHeadingDelta(previous, next);

    if (Math.abs(delta) <= deadzoneDegrees) {
        return normalizeDegrees(previous);
    }

    const smoothedDelta = Math.max(
        -maxStepDegrees,
        Math.min(maxStepDegrees, delta * smoothing),
    );

    return normalizeDegrees(previous + smoothedDelta);
}

export function getHeadingDifference(firstHeading, secondHeading) {
    const first = Number(firstHeading);
    const second = Number(secondHeading);

    if (!Number.isFinite(first) || !Number.isFinite(second)) {
        return Number.POSITIVE_INFINITY;
    }

    return Math.abs(getShortestHeadingDelta(first, second));
}

export function getFreshCompassHeading(userLocation, now = Date.now(), maxAgeMs = COMPASS_HEADING_MAX_AGE_MS) {
    const heading = Number(userLocation?.compassHeading);
    const updatedAt = Number(userLocation?.compassHeadingUpdatedAt);

    if (!Number.isFinite(heading) || !Number.isFinite(updatedAt)) {
        return null;
    }

    return now - updatedAt <= maxAgeMs ? normalizeDegrees(heading) : null;
}

export function getRouteSnappedNavigationLocation(
    location,
    route,
    {
        previousLocation = null,
        speedKmh = 0,
        maxSnapDistanceMeters = 120,
    } = {},
) {
    const snap = getClosestRouteProjection(route?.geometry?.coordinates ?? [], location);

    if (!snap) return location;

    const accuracy = Number(location?.accuracy) || 0;
    const snapThresholdMeters = Math.min(maxSnapDistanceMeters, Math.max(35, accuracy * 1.8));

    if (snap.distanceMeters > snapThresholdMeters) {
        return {
            ...location,
            routeDistanceMeters: snap.distanceMeters,
            routeProgressMeters: snap.progressMeters,
        };
    }

    return smoothSnappedNavigationLocation({
        ...location,
        rawLatitude: location.latitude,
        rawLongitude: location.longitude,
        latitude: snap.latitude,
        longitude: snap.longitude,
        routeDistanceMeters: snap.distanceMeters,
        routeProgressMeters: snap.progressMeters,
        routeBearing: snap.bearing,
    }, previousLocation, speedKmh);
}

export function getClosestRouteProjection(coordinates, location) {
    if (!coordinates?.length || coordinates.length < 2 || !location) {
        return null;
    }

    const point = [Number(location.longitude), Number(location.latitude)];

    if (!Number.isFinite(point[0]) || !Number.isFinite(point[1])) {
        return null;
    }

    let best = null;
    let progressBeforeSegment = 0;

    for (let index = 1; index < coordinates.length; index += 1) {
        const start = coordinates[index - 1];
        const finish = coordinates[index];

        if (!isValidCoordinate(start) || !isValidCoordinate(finish)) {
            continue;
        }

        const segmentDistance = getDistanceMeters(
            { longitude: start[0], latitude: start[1] },
            { longitude: finish[0], latitude: finish[1] },
        );
        const projection = projectPointToSegment(point, start, finish, point);
        const distanceMeters = getDistanceMeters(
            { longitude: point[0], latitude: point[1] },
            { longitude: projection.coordinate[0], latitude: projection.coordinate[1] },
        );

        if (!best || distanceMeters < best.distanceMeters) {
            best = {
                latitude: projection.coordinate[1],
                longitude: projection.coordinate[0],
                distanceMeters,
                progressMeters: progressBeforeSegment + (segmentDistance * projection.t),
                bearing: getBearingDegrees(start, finish),
            };
        }

        progressBeforeSegment += segmentDistance;
    }

    return best;
}

function smoothSnappedNavigationLocation(location, previousLocation, speedKmh) {
    if (
        !previousLocation
        || !Number.isFinite(Number(previousLocation.latitude))
        || !Number.isFinite(Number(previousLocation.longitude))
    ) {
        return location;
    }

    const speed = Number(speedKmh) || 0;
    const factor = speed > 18 ? 0.58 : 0.42;

    return {
        ...location,
        latitude: Number(previousLocation.latitude) + ((Number(location.latitude) - Number(previousLocation.latitude)) * factor),
        longitude: Number(previousLocation.longitude) + ((Number(location.longitude) - Number(previousLocation.longitude)) * factor),
    };
}

function projectPointToSegment(point, start, finish, origin) {
    const projectedPoint = toLocalMeters(point, origin);
    const projectedStart = toLocalMeters(start, origin);
    const projectedFinish = toLocalMeters(finish, origin);
    const dx = projectedFinish.x - projectedStart.x;
    const dy = projectedFinish.y - projectedStart.y;
    const lengthSquared = (dx * dx) + (dy * dy);
    const t = lengthSquared > 0
        ? Math.max(0, Math.min(1, (((projectedPoint.x - projectedStart.x) * dx) + ((projectedPoint.y - projectedStart.y) * dy)) / lengthSquared))
        : 0;

    return {
        t,
        coordinate: [
            Number(start[0]) + ((Number(finish[0]) - Number(start[0])) * t),
            Number(start[1]) + ((Number(finish[1]) - Number(start[1])) * t),
        ],
    };
}

function toLocalMeters(coordinate, origin) {
    const metersPerDegreeLat = 111320;
    const metersPerDegreeLng = metersPerDegreeLat * Math.cos((Number(origin[1]) * Math.PI) / 180);

    return {
        x: (Number(coordinate[0]) - Number(origin[0])) * metersPerDegreeLng,
        y: (Number(coordinate[1]) - Number(origin[1])) * metersPerDegreeLat,
    };
}

function isValidCoordinate(coordinate) {
    return Array.isArray(coordinate)
        && Number.isFinite(Number(coordinate[0]))
        && Number.isFinite(Number(coordinate[1]));
}

function getDistanceMeters(origin, target) {
    const latitude = Number(target?.latitude);
    const longitude = Number(target?.longitude);
    const originLatitude = Number(origin?.latitude);
    const originLongitude = Number(origin?.longitude);

    if (
        !Number.isFinite(latitude)
        || !Number.isFinite(longitude)
        || !Number.isFinite(originLatitude)
        || !Number.isFinite(originLongitude)
    ) {
        return Number.POSITIVE_INFINITY;
    }

    const earthRadius = 6371000;
    const dLat = toRadians(latitude - originLatitude);
    const dLng = toRadians(longitude - originLongitude);
    const lat1 = toRadians(originLatitude);
    const lat2 = toRadians(latitude);
    const a = Math.sin(dLat / 2) ** 2
        + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

    return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getBearingDegrees(start, finish) {
    const startLat = toRadians(start[1]);
    const finishLat = toRadians(finish[1]);
    const deltaLng = toRadians(finish[0] - start[0]);
    const y = Math.sin(deltaLng) * Math.cos(finishLat);
    const x = Math.cos(startLat) * Math.sin(finishLat)
        - Math.sin(startLat) * Math.cos(finishLat) * Math.cos(deltaLng);

    return normalizeDegrees(toDegrees(Math.atan2(y, x)));
}

function toRadians(value) {
    return Number(value) * Math.PI / 180;
}

function toDegrees(value) {
    return Number(value) * 180 / Math.PI;
}

function normalizeDegrees(value) {
    return ((Number(value) % 360) + 360) % 360;
}

function getShortestHeadingDelta(from, to) {
    return ((((Number(to) - Number(from)) % 360) + 540) % 360) - 180;
}

export function pickUpcomingSpeedCamera(
    speedCameras,
    userLocation,
    route,
    {
        getRouteProgressMeters,
        getDistanceToRouteMeters,
        routeDistanceThresholdMeters,
        passedDistanceMeters = DEFAULT_PASSED_CAMERA_DISTANCE_METERS,
    } = {},
) {
    if (
        !speedCameras?.length
        || !userLocation
        || !route?.geometry?.coordinates?.length
        || typeof getRouteProgressMeters !== 'function'
        || typeof getDistanceToRouteMeters !== 'function'
    ) {
        return null;
    }

    const currentProgress = getRouteProgressMeters(route.geometry.coordinates, userLocation);
    const maxRouteDistance = Number(routeDistanceThresholdMeters);

    return speedCameras
        .map((camera) => ({
            ...camera,
            routeOffsetMeters: Number.isFinite(Number(camera.routeOffsetMeters))
                ? Number(camera.routeOffsetMeters)
                : getRouteProgressMeters(route.geometry.coordinates, camera),
            routeDistanceMeters: Number.isFinite(Number(camera.routeDistanceMeters))
                ? Number(camera.routeDistanceMeters)
                : getDistanceToRouteMeters(route, camera),
        }))
        .map((camera) => ({
            ...camera,
            distanceMeters: camera.routeOffsetMeters - currentProgress,
        }))
        .filter((camera) => (
            Number.isFinite(camera.distanceMeters)
            && camera.distanceMeters > passedDistanceMeters
            && (!Number.isFinite(maxRouteDistance) || camera.routeDistanceMeters < maxRouteDistance)
        ))
        .sort((first, second) => first.distanceMeters - second.distanceMeters)[0] ?? null;
}
