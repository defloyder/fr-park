import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
    getCompassEventPriority,
    getHeadingDifference,
    getRouteSnappedNavigationLocation,
    isManualMapInteraction,
    normalizeCompassHeading,
    pickUpcomingSpeedCamera,
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

test('manual map move events detach navigation follow', () => {
    const mapSource = readFileSync(new URL('../../resources/js/modules/map.js', import.meta.url), 'utf8');

    assert.match(mapSource, /map\.on\('movestart'[\s\S]*detachNavigationOnManualInteraction\(event\)/);
    assert.match(mapSource, /map\.on\('pitchstart', detachNavigationOnManualInteraction\)/);
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
    assert.doesNotMatch(formSource, /bearing: getNavigationCameraBearing|bearing: heading|getNavigationCameraBearing/);
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

test('speed camera rendering filters invalid coordinates before MapLibre receives data', () => {
    const mapSource = readFileSync(new URL('../../resources/js/modules/map.js', import.meta.url), 'utf8');
    const renderSpeedCameras = mapSource.match(/export function renderSpeedCameras[\s\S]*?\n\}/)?.[0] ?? '';

    assert.match(renderSpeedCameras, /Number\.isFinite\(longitude\)/);
    assert.match(renderSpeedCameras, /Number\.isFinite\(latitude\)/);
    assert.match(renderSpeedCameras, /features,/);
});

test('nearest maneuver hint is rendered on the map', () => {
    const mapSource = readFileSync(new URL('../../resources/js/modules/map.js', import.meta.url), 'utf8');
    const formSource = readFileSync(new URL('../../resources/js/modules/parking-form.js', import.meta.url), 'utf8');

    assert.match(mapSource, /export function updateRouteManeuverHint/);
    assert.match(mapSource, /new maplibregl\.Marker/);
    assert.match(mapSource, /getRouteCoordinateAtProgress/);
    assert.match(formSource, /updateRouteManeuverHint\(instruction, state\.navigationRoute/);
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
