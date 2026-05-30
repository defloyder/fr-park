import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
    isManualMapInteraction,
    normalizeCompassHeading,
    pickUpcomingSpeedCamera,
    shouldFollowNavigationPosition,
    shouldFollowUserLocation,
    shouldRecenterNavigationFromLocate,
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

test('GPS cursor heading is not coupled to manual map rotation', () => {
    const mapSource = readFileSync(new URL('../../resources/js/modules/map.js', import.meta.url), 'utf8');
    const userLocationLayer = mapSource.match(/id: 'user-location-dot'[\s\S]*?layout: \{[\s\S]*?\},\n    \}\);/)?.[0] ?? '';

    assert.match(userLocationLayer, /'icon-rotation-alignment': 'viewport'/);
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
