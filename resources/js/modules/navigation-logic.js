export const DEFAULT_PASSED_CAMERA_DISTANCE_METERS = 8;

export function shouldRecenterNavigationFromLocate({ isNavigationMode = false, hasRoute = false } = {}) {
    return Boolean(isNavigationMode && hasRoute);
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
