import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
    getCompassEventPriority,
    getHeadingDifference,
    getNavigationRerouteDecision,
    getRouteSnappedNavigationLocation,
    getSpeedTransitionDurationMs,
    interpolateSpeedKmh,
    isManualMapInteraction,
    normalizeCompassHeading,
    pickUpcomingSpeedCamera,
    selectUpcomingRouteInstruction,
    shouldFollowNavigationPosition,
    shouldFollowUserLocation,
    shouldRecenterNavigationFromLocate,
    smoothCompassHeading,
} from '../../resources/js/modules/navigation-logic.js';

const route = {
    geometry: {
        coordinates: [
            [37.0, 55.0],
            [37.1, 55.1],
        ],
    },
};

function makeProgressByOffset(currentProgress) {
    return (_, point) => point.progressMeters ?? currentProgress;
}

test('GPS button recenters navigation even before a cached user location exists', () => {
    assert.equal(shouldRecenterNavigationFromLocate({ isNavigationMode: true, hasRoute: true }), true);
    assert.equal(shouldRecenterNavigationFromLocate({ isNavigationMode: true, hasRoute: false }), false);
});

test('navigation GPS update should auto-follow map during an active route', () => {
    assert.equal(shouldFollowNavigationPosition({
        isNavigationFollowing: true,
        isNavigationDetached: false,
        hasRoute: true,
        hasLocation: true,
    }), true);
});

test('navigation GPS update should not steal map after manual detach', () => {
    assert.equal(shouldFollowNavigationPosition({
        isNavigationFollowing: true,
        isNavigationDetached: true,
        hasRoute: true,
        hasLocation: true,
    }), false);
});

test('navigation GPS update should wait while user inspects the map', () => {
    assert.equal(shouldFollowNavigationPosition({
        isNavigationFollowing: true,
        isNavigationDetached: false,
        isNavigationViewportHeld: true,
        hasRoute: true,
        hasLocation: true,
    }), false);
});

test('GPS button should keep following user location outside navigation', () => {
    assert.equal(shouldFollowUserLocation({
        isUserLocationFollowing: true,
        isNavigationMode: false,
        hasLocation: true,
    }), true);
    assert.equal(shouldFollowUserLocation({
        isUserLocationFollowing: true,
        isNavigationMode: true,
        hasLocation: true,
    }), false);
});

test('programmatic map rotation during follow must not detach navigation', () => {
    assert.equal(isManualMapInteraction({}, true), false);
    assert.equal(isManualMapInteraction({ originalEvent: { type: 'touchmove' } }, true), true);
    assert.equal(isManualMapInteraction({ originalEvent: { type: 'touchmove' } }, false), false);
});

test('manual map gestures keep navigation follow active', () => {
    const mapSource = readFileSync(new URL('../../resources/js/modules/map.js', import.meta.url), 'utf8');
    const formSource = readFileSync(new URL('../../resources/js/modules/parking-form.js', import.meta.url), 'utf8');

    assert.match(mapSource, /map\.on\('movestart'[\s\S]*detachNavigationOnManualInteraction\(event\)/);
    assert.match(mapSource, /map\.on\('pitchstart'[\s\S]*detachNavigationOnManualInteraction\(event\)/);
    assert.match(mapSource, /map:manual-interaction/);
    assert.match(mapSource, /addEventListener\('wheel', dispatchRawManualMapInteraction/);
    assert.match(mapSource, /addEventListener\('touchstart', dispatchRawManualMapInteraction/);
    assert.match(formSource, /navigation:manual-map-zoom[\s\S]*state\.navigationPreserveZoom = true/);
    assert.match(formSource, /navigation:manual-map-zoom[\s\S]*state\.navigationViewportHoldUntil = Date\.now\(\) \+ 2200/);
    assert.match(formSource, /navigation:manual-map-move[\s\S]*state\.navigationViewportHoldUntil = Date\.now\(\) \+ 6500/);
    assert.doesNotMatch(formSource, /navigation:manual-map-zoom[\s\S]*classList\.add\('is-navigation-detached'\)/);
});

test('personal navigator places are rendered as their own map layer', () => {
    const mapSource = readFileSync(new URL('../../resources/js/modules/map.js', import.meta.url), 'utf8');
    const formSource = readFileSync(new URL('../../resources/js/modules/parking-form.js', import.meta.url), 'utf8');

    assert.match(mapSource, /PERSONAL_PLACE_SOURCE_ID/);
    assert.match(mapSource, /id: 'personal-place-dot'/);
    assert.match(mapSource, /export function replacePersonalPlacesOnMap/);
    assert.match(formSource, /PERSONAL_PLACES_STORAGE_KEY/);
    assert.match(formSource, /renderNavigatorQuickPlaces/);
});

test('GPS cursor heading is not coupled to manual map rotation', () => {
    const mapSource = readFileSync(new URL('../../resources/js/modules/map.js', import.meta.url), 'utf8');
    const userLocationLayer = mapSource.match(/id: 'user-location-dot'[\s\S]*?layout: \{[\s\S]*?\},\n    \}\);/)?.[0] ?? '';

    assert.match(userLocationLayer, /'icon-rotation-alignment': 'viewport'/);
    assert.match(userLocationLayer, /'icon-pitch-alignment': 'viewport'/);
});

test('navigation camera follows route geometry instead of compass', () => {
    const mapSource = readFileSync(new URL('../../resources/js/modules/map.js', import.meta.url), 'utf8');
    const formSource = readFileSync(new URL('../../resources/js/modules/parking-form.js', import.meta.url), 'utf8');
    const focusNavigationPosition = mapSource.match(/export function focusNavigationPosition[\s\S]*?\n\}/)?.[0] ?? '';

    assert.doesNotMatch(focusNavigationPosition, /getFreshCompassHeading|compassHeading/);
    assert.match(focusNavigationPosition, /bearing = null/);
    assert.match(mapSource, /function getNavigationCameraBearing/);
    assert.match(mapSource, /const FOLLOW_CENTER_LOOKAHEAD_METERS = 12/);
    assert.match(mapSource, /const FOLLOW_BEARING_LOOKAHEAD_METERS = 45/);
    assert.match(mapSource, /function getNavigationRouteForwardBearing/);
    assert.doesNotMatch(formSource, /bearing: getNavigationCameraBearing|bearing: heading|getNavigationCameraBearing/);
});

test('background user GPS updates do not force map recenter after manual movement', () => {
    const formSource = readFileSync(new URL('../../resources/js/modules/parking-form.js', import.meta.url), 'utf8');
    const startUserLocationTracking = formSource.match(/function startUserLocationTracking[\s\S]*?function applyUserLocationCoords/)?.[0] ?? '';

    assert.doesNotMatch(startUserLocationTracking, /applyUserLocationCoords\(coords, \{ focus: true \}\)/);
    assert.doesNotMatch(startUserLocationTracking, /focus: !document\.body\.classList\.contains/);
    assert.match(startUserLocationTracking, /applyUserLocationCoords\(coords, \{ focus: false \}\)/);
});

test('GPS cursor heading does not fall back to GPS course', () => {
    const formSource = readFileSync(new URL('../../resources/js/modules/parking-form.js', import.meta.url), 'utf8');
    const getNavigationHeading = formSource.match(/function getNavigationHeading[\s\S]*?\n    \}/)?.[0] ?? '';
    const getNavigationMarkerHeading = formSource.match(/function getNavigationMarkerHeading[\s\S]*?\n    \}/)?.[0] ?? '';
    const applyUserLocationCoords = formSource.match(/function applyUserLocationCoords[\s\S]*?focusUserLocation/)?.[0] ?? '';
    const applyNavigationLocationCoords = formSource.match(/function applyNavigationLocationCoords[\s\S]*?focusUserLocation/)?.[0] ?? '';

    assert.doesNotMatch(getNavigationHeading, /gpsHeading/);
    assert.match(getNavigationMarkerHeading, /getNavigationMarkerPatch/);
    assert.doesNotMatch(applyUserLocationCoords, /getNavigationHeading\(gpsHeading\)/);
    assert.doesNotMatch(applyNavigationLocationCoords, /getNavigationHeading\(gpsHeading\)/);
});

test('navigation GPS cursor is locked to route segment heading', () => {
    const formSource = readFileSync(new URL('../../resources/js/modules/parking-form.js', import.meta.url), 'utf8');
    const mapSource = readFileSync(new URL('../../resources/js/modules/map.js', import.meta.url), 'utf8');
    const getRouteMarkerHeading = formSource.match(/function getRouteMarkerHeading[\s\S]*?\n    \}/)?.[0] ?? '';

    assert.match(getRouteMarkerHeading, /routeBearing/);
    assert.match(mapSource, /id: 'user-navigation-dot'/);
    assert.match(mapSource, /'icon-rotation-alignment': 'map'/);
});

test('navigation position is snapped to route before rendering', () => {
    const formSource = readFileSync(new URL('../../resources/js/modules/parking-form.js', import.meta.url), 'utf8');
    const applyNavigationLocationCoords = formSource.match(/function applyNavigationLocationCoords[\s\S]*?saveNavigationState\(\);/)?.[0] ?? '';
    const getRouteProgressMeters = formSource.match(/function getRouteProgressMeters[\s\S]*?\n    \}/)?.[0] ?? '';
    const getDistanceToRouteMeters = formSource.match(/function getDistanceToRouteMeters[\s\S]*?\n    \}/)?.[0] ?? '';

    assert.match(applyNavigationLocationCoords, /getRouteSnappedNavigationLocation\(rawLocation, state\.navigationRoute, \{/);
    assert.match(getRouteProgressMeters, /routeProgressMeters/);
    assert.match(getDistanceToRouteMeters, /routeDistanceMeters/);
});

test('navigation route snapping is available as executable logic', () => {
    const snapped = getRouteSnappedNavigationLocation(
        { latitude: 55.0004, longitude: 37.0002, accuracy: 12 },
        {
            geometry: {
                coordinates: [
                    [37, 55],
                    [37, 55.01],
                ],
            },
        },
    );

    assert.ok(Math.abs(snapped.longitude - 37) < 0.00001);
    assert.ok(snapped.routeDistanceMeters > 10);
    assert.ok(snapped.routeProgressMeters > 0);
});

test('navigation route progress is smoothed and does not jump backwards', () => {
    const route = {
        geometry: {
            coordinates: [
                [37, 55],
                [37, 55.01],
            ],
        },
    };
    const previousLocation = {
        latitude: 55.0045,
        longitude: 37,
        routeProgressMeters: 500,
    };

    const forward = getRouteSnappedNavigationLocation(
        { latitude: 55.006, longitude: 37.00002, accuracy: 8 },
        route,
        { previousLocation, speedKmh: 36 },
    );
    const backward = getRouteSnappedNavigationLocation(
        { latitude: 55.0001, longitude: 37.00002, accuracy: 8 },
        route,
        { previousLocation, speedKmh: 36 },
    );

    assert.ok(forward.routeProgressMeters > previousLocation.routeProgressMeters);
    assert.ok(forward.routeProgressMeters < 700);
    assert.ok(backward.routeProgressMeters >= previousLocation.routeProgressMeters - 3);
});

test('speed camera rendering filters invalid coordinates before MapLibre receives data', () => {
    const mapSource = readFileSync(new URL('../../resources/js/modules/map.js', import.meta.url), 'utf8');
    const renderSpeedCameras = mapSource.match(/export function renderSpeedCameras[\s\S]*?\n\}/)?.[0] ?? '';

    assert.match(renderSpeedCameras, /Number\.isFinite\(longitude\)/);
    assert.match(renderSpeedCameras, /Number\.isFinite\(latitude\)/);
    assert.match(renderSpeedCameras, /features,/);
});

test('cluster labels use text instead of pre-rendering hundreds of canvas images', () => {
    const mapSource = readFileSync(new URL('../../resources/js/modules/map.js', import.meta.url), 'utf8');
    const initMapLoad = mapSource.match(/map\.once\('load'[\s\S]*?bindMapEvents\(\);/)?.[0] ?? '';
    const clusterCountLayer = mapSource.match(/id: 'cluster-count'[\s\S]*?\n    \}\);/)?.[0] ?? '';

    assert.doesNotMatch(initMapLoad, /addClusterCountImages\(\)/);
    assert.match(clusterCountLayer, /'text-field': \['get', 'point_count_abbreviated'\]/);
});

test('nearest maneuver hint is rendered on the map', () => {
    const mapSource = readFileSync(new URL('../../resources/js/modules/map.js', import.meta.url), 'utf8');
    const formSource = readFileSync(new URL('../../resources/js/modules/parking-form.js', import.meta.url), 'utf8');

    assert.match(mapSource, /export function updateRouteManeuverHint/);
    assert.match(mapSource, /new maplibregl\.Marker/);
    assert.match(mapSource, /\.setLngLat\(coordinate\)\.addTo\(map\)/);
    assert.match(mapSource, /const targetProgressMeters = instructionStartMeters/);
    assert.match(mapSource, /offset: \[0, -10\]/);
    assert.match(mapSource, /getRouteCoordinateAtProgress/);
    assert.match(mapSource, /getRouteManeuverCoordinate/);
    assert.match(mapSource, /turnAngle < 18/);
    assert.match(formSource, /updateRouteManeuverHint\(instruction, state\.navigationRoute/);
});

test('route geojson is sanitized before MapLibre setData receives it', () => {
    const mapSource = readFileSync(new URL('../../resources/js/modules/map.js', import.meta.url), 'utf8');

    assert.match(mapSource, /function sanitizeRoute/);
    assert.match(mapSource, /function sanitizeLineCoordinates/);
    assert.match(mapSource, /source\?\.setData\(buildRouteFeatureCollection\(safeRoute\)\)/);
    assert.doesNotMatch(mapSource, /directDistanceMeters > 50000[\s\S]*throw error/);
});

test('active navigation route is trimmed by smoothed progress', () => {
    const mapSource = readFileSync(new URL('../../resources/js/modules/map.js', import.meta.url), 'utf8');
    const updateActiveRouteProgress = mapSource.match(/export function updateActiveRouteProgress[\s\S]*?safeSetRouteLineColor/)?.[0] ?? '';

    assert.match(updateActiveRouteProgress, /trimRouteByProgress/);
    assert.match(mapSource, /function getLineCoordinatesAfterProgress/);
    assert.match(mapSource, /progressMeters - 6/);
});

test('close controls stay red across map themes', () => {
    const cssSource = readFileSync(new URL('../../resources/css/map-ui.css', import.meta.url), 'utf8');

    assert.match(cssSource, /\.icon-button\[data-action\^="close"\]/);
    assert.match(cssSource, /\.route-picker__close/);
    assert.match(cssSource, /\.photo-lightbox__close/);
    assert.match(cssSource, /#BE123C/);
});

test('map settings expose selectable GPS cursor icons', () => {
    const mapSource = readFileSync(new URL('../../resources/js/modules/map.js', import.meta.url), 'utf8');
    const viewSource = readFileSync(new URL('../../resources/views/pages/map.blade.php', import.meta.url), 'utf8');
    const cssSource = readFileSync(new URL('../../resources/css/map-ui.css', import.meta.url), 'utf8');

    assert.match(viewSource, /data-map-settings-toggle/);
    assert.match(mapSource, /redbull-f1/);
    assert.match(mapSource, /ferrari-f1/);
    assert.match(mapSource, /createPlaneSvg/);
    assert.match(mapSource, /createHelicopterSvg/);
    assert.match(mapSource, /createBuranSvg/);
    assert.match(mapSource, /settings\.classList\.remove\('is-open'\)/);
    assert.match(mapSource, /iconImage: getUserLocationIconImage/);
    assert.match(cssSource, /\.map-settings__grid/);
    assert.match(cssSource, /right: calc\(100% \+ 12px\)/);
    assert.match(cssSource, /width: min\(250px, calc\(100vw - 120px\)\)/);
});

test('in-app route build falls back to last known location instead of rejecting inaccurate GPS', () => {
    const formSource = readFileSync(new URL('../../resources/js/modules/parking-form.js', import.meta.url), 'utf8');
    const buildInAppRoute = formSource.match(/async function buildInAppRoute[\s\S]*?finally/)?.[0] ?? '';

    assert.match(buildInAppRoute, /ensureRouteStartLocation\(\)/);
    assert.match(formSource, /function resetFailedRouteBuildState/);
    assert.match(formSource, /resetFailedRouteBuildState\(\);[\s\S]*startDeviceHeadingWatch/);
    assert.doesNotMatch(formSource, /function assertRouteLocation|Location is too inaccurate/);
    assert.match(formSource, /if \(state\.userLocation\) \{\s*return state\.userLocation;/);
});

test('light map layer has no edge vignette overlay', () => {
    const cssSource = readFileSync(new URL('../../resources/css/map-ui.css', import.meta.url), 'utf8');

    assert.match(cssSource, /body\[data-map-layer="light"\] \.map-screen > \.map-canvas::after/);
    assert.match(cssSource, /background: none/);
});

test('passed speed camera is skipped instead of sticking at zero meters', () => {
    const camera = pickUpcomingSpeedCamera(
        [
            { id: 'passed', progressMeters: 95 },
            { id: 'next', progressMeters: 150 },
        ],
        { progressMeters: 110 },
        route,
        {
            getRouteProgressMeters: makeProgressByOffset(110),
            getDistanceToRouteMeters: () => 0,
            routeDistanceThresholdMeters: 160,
        },
    );

    assert.equal(camera.id, 'next');
    assert.equal(camera.distanceMeters, 40);
});

test('passed route maneuver advances to the next instruction', () => {
    const instruction = selectUpcomingRouteInstruction([
        { id: 'depart', distanceFromStartMeters: 0 },
        { id: 'turn', distanceFromStartMeters: 120 },
    ], 12);

    assert.equal(instruction.id, 'turn');
    assert.equal(instruction.remainingMeters, 108);
});

test('route refresh waits for a stable deviation and then reroutes quickly', () => {
    const first = getNavigationRerouteDecision({
        distanceFromRouteMeters: 110,
        now: 10000,
    });
    const confirmed = getNavigationRerouteDecision({
        distanceFromRouteMeters: 110,
        offRouteSince: first.offRouteSince,
        now: 11600,
    });

    assert.equal(first.shouldRefresh, false);
    assert.equal(confirmed.shouldRefresh, true);
});

test('route refresh resets deviation state after returning to route', () => {
    const decision = getNavigationRerouteDecision({
        distanceFromRouteMeters: 20,
        offRouteSince: 10000,
        now: 12000,
    });

    assert.deepEqual(decision, { shouldRefresh: false, offRouteSince: 0 });
});

test('speed HUD transition passes through each real integer value', () => {
    const duration = getSpeedTransitionDurationMs(30, 40);
    const values = Array.from({ length: 11 }, (_, index) => (
        Math.round(interpolateSpeedKmh(30, 40, duration * index / 10, duration))
    ));

    assert.deepEqual(values, [30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40]);
    assert.equal(getSpeedTransitionDurationMs(40, 40), 0);

    const formSource = readFileSync(new URL('../../resources/js/modules/parking-form.js', import.meta.url), 'utf8');
    assert.match(formSource, /setNavigationSpeedTarget\(getGpsSpeedKmh\(coords\)\)/);
    assert.match(formSource, /setTimeout\(animate, stepIntervalMs\)/);
    assert.match(formSource, /current \+ direction/);
    assert.match(formSource, /state\.displayedSpeedKmh/);
});

test('speed camera at zero meters is hidden and next server-projected camera is selected', () => {
    const camera = pickUpcomingSpeedCamera(
        [
            { id: 'current', routeOffsetMeters: 110, routeDistanceMeters: 0 },
            { id: 'next', routeOffsetMeters: 190, routeDistanceMeters: 0 },
        ],
        { progressMeters: 110 },
        route,
        {
            getRouteProgressMeters: makeProgressByOffset(110),
            getDistanceToRouteMeters: () => 0,
            routeDistanceThresholdMeters: 160,
        },
    );

    assert.equal(camera.id, 'next');
    assert.equal(camera.distanceMeters, 80);
});

test('camera alert resets when no upcoming camera remains', () => {
    const camera = pickUpcomingSpeedCamera(
        [{ id: 'passed', progressMeters: 95 }],
        { progressMeters: 110 },
        route,
        {
            getRouteProgressMeters: makeProgressByOffset(110),
            getDistanceToRouteMeters: () => 0,
            routeDistanceThresholdMeters: 160,
        },
    );

    assert.equal(camera, null);
});

test('device orientation heading is normalized for iOS and absolute sensors', () => {
    assert.equal(normalizeCompassHeading({ webkitCompassHeading: 725 }), 5);
    assert.equal(normalizeCompassHeading({ absolute: true, alpha: 90 }, 0), 270);
    assert.equal(normalizeCompassHeading({ absolute: true, alpha: 90 }, 90), 0);
    assert.equal(normalizeCompassHeading({ alpha: 90 }, 0), 270);
    assert.equal(normalizeCompassHeading({ alpha: 90 }, 90), 0);
});

test('compass heading is smoothed across jitter and wraparound', () => {
    assert.equal(smoothCompassHeading(null, 725), 5);
    assert.equal(smoothCompassHeading(10, 11), 10);
    assert.equal(smoothCompassHeading(350, 10, { smoothing: 0.5, deadzoneDegrees: 0, maxStepDegrees: 30 }), 0);
    assert.equal(smoothCompassHeading(0, 180), 336);
    assert.equal(getHeadingDifference(350, 10), 20);
    assert.equal(getHeadingDifference(2, 358), 4);
});

test('absolute compass events outrank fallback orientation events', () => {
    assert.equal(getCompassEventPriority({ webkitCompassHeading: 12 }), 2);
    assert.equal(getCompassEventPriority({ absolute: true, alpha: 12 }), 2);
    assert.equal(getCompassEventPriority({ alpha: 12 }), 1);
});

test('GPS failure clears live navigation values and exposes a warning', () => {
    const formSource = readFileSync(new URL('../../resources/js/modules/parking-form.js', import.meta.url), 'utf8');
    const errorHandler = formSource.match(/function handleNavigationLocationError[\s\S]*?function isNavigationViewportHeld/)?.[0] ?? '';

    assert.match(errorHandler, /state\.navigationGpsAvailable = false/);
    assert.match(errorHandler, /clearTimeout\(state\.navigationSpeedAnimationTimer\)/);
    assert.match(errorHandler, /state\.currentSpeedKmh = 0/);
    assert.match(formSource, /state\.displayedSpeedKmh = 0/);
    assert.doesNotMatch(errorHandler, /updatedAt: Date\.now/);
    assert.match(formSource, /GPS недоступен/);
    assert.match(formSource, /Ожидание сигнала GPS/);
});

test('map labels only request font stacks available from OpenFreeMap', () => {
    const mapSource = readFileSync(new URL('../../resources/js/modules/map.js', import.meta.url), 'utf8');

    assert.doesNotMatch(mapSource, /Open Sans/);
    assert.match(mapSource, /Noto Sans Bold/);
    assert.match(mapSource, /Noto Sans Regular/);
});

test('offline PWA fallback is readable and does not reuse dynamic map HTML', () => {
    const workerSource = readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8');
    const appSource = readFileSync(new URL('../../resources/js/app.js', import.meta.url), 'utf8');
    const offlineSource = readFileSync(new URL('../../public/offline.html', import.meta.url), 'utf8');

    assert.match(workerSource, /networkFirst\(request, '\/offline\.html'\)/);
    assert.match(workerSource, /fetch\(request, \{ cache: 'no-store' \}\)/);
    assert.match(workerSource, /charset=utf-8/);
    assert.doesNotMatch(workerSource, /cache\.put\(fallbackUrl/);
    assert.match(appSource, /updateViaCache: 'none'/);
    assert.match(appSource, /registration\.update\(\)/);
    assert.match(offlineSource, /<meta charset="utf-8">/);
    assert.match(offlineSource, /Нет подключения к сети/);
});

test('primary mobile controls keep at least 44 pixel touch targets', () => {
    const cssSource = readFileSync(new URL('../../resources/css/map-ui.css', import.meta.url), 'utf8');

    assert.match(cssSource, /\.map-control-button\s*\{[^}]*width: 44px;[^}]*height: 44px;/);
    assert.match(cssSource, /\.export-check\s*\{[^}]*width: 44px;[^}]*height: 44px;/);
    assert.match(cssSource, /\.spot-list__content\s*\{[^}]*min-height: 44px;/);
    assert.doesNotMatch(cssSource, /\.spot-card__actions \.(?:favorite-button|edit-button)\s*\{[^}]*min-height: (?:34|38)px;/);
    assert.match(cssSource, /\.navigator-panel \.panel-close,[\s\S]*?min-height: 44px;/);
    assert.match(cssSource, /\.photo-dropzone__actions \.ghost-button,[\s\S]*?min-height: 46px;/);
});

test('light map style exposes detailed green areas and a clear road hierarchy', () => {
    const mapSource = readFileSync(new URL('../../resources/js/modules/map.js', import.meta.url), 'utf8');

    for (const layerId of [
        'landcover-wood',
        'landcover-grass',
        'landcover-wetland',
        'landuse-green',
        'landuse-residential',
        'landuse-civic',
        'waterway-line',
        'building-footprint',
        'rail-line',
        'road-path',
        'transit-labels',
        'road-lane-major-left',
        'road-lane-major-right',
        'road-lane-major-outer-left',
        'road-lane-major-outer-right',
        'road-center-double-left',
        'road-center-double-right',
        'road-oneway-divider',
        'road-junction-arrows',
    ]) {
        assert.match(mapSource, new RegExp(`id: '${layerId}'`));
    }

    assert.doesNotMatch(mapSource, /id: 'road-direction-arrows'/);
    assert.match(mapSource, /'background-color': '#F4F3ED'/);
    assert.match(mapSource, /'fill-color': '#BFDDAE'/);
    assert.match(mapSource, /'fill-color': '#D8ECCB'/);
    assert.match(mapSource, /'fill-extrusion-color': '#D2D8D3'/);
    assert.match(mapSource, /'motorway',\s*'#FFDFA3'/);
});
