export const DEFAULT_PASSED_CAMERA_DISTANCE_METERS = 8;
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

export function getFreshCompassHeading(userLocation, now = Date.now(), maxAgeMs = COMPASS_HEADING_MAX_AGE_MS) {
    const heading = Number(userLocation?.compassHeading);
    const updatedAt = Number(userLocation?.compassHeadingUpdatedAt);

    if (!Number.isFinite(heading) || !Number.isFinite(updatedAt)) {
        return null;
    }

    return now - updatedAt <= maxAgeMs ? normalizeDegrees(heading) : null;
}

function normalizeDegrees(value) {
    return ((Number(value) % 360) + 360) % 360;
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
            routeOffsetMeters: getRouteProgressMeters(route.geometry.coordinates, camera),
            routeDistanceMeters: getDistanceToRouteMeters(route, camera),
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
