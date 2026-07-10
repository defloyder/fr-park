import {
    BoxGeometry,
    CylinderGeometry,
    Group,
    Mesh,
    MeshBasicMaterial,
    SphereGeometry,
} from 'three';

import { createNavigationVehicleMaterials } from './vehicle-materials.js';
import {
    createRoundedVehiclePart,
    createSideWheel,
    createTaperedVehiclePart,
    createVehiclePanel,
} from './vehicle-parts.js';
import { getNavigationVehicleProfile } from './vehicle-profiles.js';

export function createNavigationCarModel(iconId, modelLengthMeters) {
    const profile = getNavigationVehicleProfile(iconId, modelLengthMeters);
    const group = new Group();
    const materials = createNavigationVehicleMaterials(profile);

    group.name = `vehicle-car-${iconId}`;
    group.userData.iconId = iconId;
    group.userData.axes = {
        forward: '+Y',
        up: '+Z',
    };

    addVehicleShadow(group, profile);

    const lower = createTaperedVehiclePart({
        bottomWidth: profile.width * 1.18,
        bottomLength: profile.length * 0.98,
        topWidth: profile.width * 1.06,
        topLength: profile.length * 0.92,
        height: profile.lowerHeight,
        material: materials.side,
    });
    lower.position.z = profile.rideHeight + (profile.lowerHeight / 2);
    lower.userData.role = 'side';
    group.add(lower);

    const chassis = createTaperedVehiclePart({
        bottomWidth: profile.width * 1.06,
        bottomLength: profile.length,
        topWidth: profile.width * 0.88,
        topLength: profile.length * 0.88,
        height: profile.bodyHeight,
        material: materials.body,
    });
    chassis.position.z = profile.rideHeight + profile.lowerHeight + (profile.bodyHeight / 2);
    chassis.userData.role = 'body';
    group.add(chassis);

    addVehicleVerticalBodySides(group, profile, materials, chassis);

    const bonnet = createTaperedVehiclePart({
        bottomWidth: profile.width * 0.76,
        bottomLength: profile.length * 0.28,
        topWidth: profile.width * 0.58,
        topLength: profile.length * 0.20,
        height: profile.panelHeight * 2.2,
        material: materials.bodyHighlight,
    });
    bonnet.position.set(0, profile.length * 0.24, chassis.position.z + (profile.bodyHeight / 2) + 0.07);
    bonnet.userData.role = 'body-highlight';
    group.add(bonnet);

    const rearDeck = createTaperedVehiclePart({
        bottomWidth: profile.width * 0.76,
        bottomLength: profile.length * 0.23,
        topWidth: profile.width * 0.58,
        topLength: profile.length * 0.16,
        height: profile.panelHeight * 2.2,
        material: materials.bodyHighlight,
    });
    rearDeck.position.set(0, -profile.length * 0.32, chassis.position.z + (profile.bodyHeight / 2) + 0.07);
    rearDeck.userData.role = 'body-highlight';
    group.add(rearDeck);

    const cabin = createTaperedVehiclePart({
        bottomWidth: profile.cabinWidth,
        bottomLength: profile.cabinLength,
        topWidth: profile.roofWidth,
        topLength: profile.roofLength,
        height: profile.cabinHeight,
        material: materials.glass,
    });
    cabin.position.set(0, profile.cabinY, chassis.position.z + (profile.bodyHeight / 2) + (profile.cabinHeight / 2));
    cabin.userData.role = 'glass';
    group.add(cabin);

    const roof = createTaperedVehiclePart({
        bottomWidth: profile.roofWidth,
        bottomLength: profile.roofLength,
        topWidth: profile.roofWidth * 0.86,
        topLength: profile.roofLength * 0.82,
        height: profile.roofHeight,
        material: materials.body,
    });
    roof.position.set(0, profile.roofY, cabin.position.z + (profile.cabinHeight / 2) + (profile.roofHeight / 2) - 0.02);
    roof.userData.role = 'body';
    group.add(roof);

    addVehicleGlassPanels(group, profile, materials, chassis, cabin);
    addVehicleWheels(group, profile, materials);
    addVehicleLights(group, profile, materials, chassis);
    addVehicleDetails(group, profile, materials, chassis, roof);

    return group;
}

function addVehicleShadow(group, profile) {
    const shadow = new Mesh(
        new CylinderGeometry(1, 1, 0.025, 48),
        new MeshBasicMaterial({
            color: 0x000000,
            transparent: true,
            opacity: profile.shadowOpacity,
            depthWrite: false,
        }),
    );
    shadow.rotation.x = Math.PI / 2;
    shadow.scale.set(profile.width * 0.68, profile.length * 0.54, 1);
    shadow.position.z = 0.035;
    group.add(shadow);
}

function addVehicleVerticalBodySides(group, profile, materials, chassis) {
    const sideZ = chassis.position.z - (profile.bodyHeight * 0.02);

    [-1, 1].forEach((side) => {
        const sideWall = new Mesh(
            new BoxGeometry(0.14, profile.length * 0.86, profile.bodyHeight * 0.86),
            materials.side,
        );
        sideWall.position.set(side * (profile.width / 2 + 0.02), -0.02, sideZ);
        sideWall.userData.role = 'body-side';
        group.add(sideWall);

        const rocker = new Mesh(
            new BoxGeometry(0.18, profile.length * 0.64, profile.bodyHeight * 0.16),
            materials.accent,
        );
        rocker.position.set(side * (profile.width / 2 + 0.08), -0.10, profile.rideHeight + profile.wheelRadius * 0.92);
        rocker.userData.role = 'side-rocker';
        group.add(rocker);
    });

    const frontBumper = new Mesh(
        new BoxGeometry(profile.width * 0.72, 0.10, profile.bodyHeight * 0.42),
        materials.bodyHighlight,
    );
    frontBumper.position.set(0, profile.length * 0.51, chassis.position.z - profile.bodyHeight * 0.02);
    frontBumper.userData.role = 'front-bumper';
    group.add(frontBumper);

    const rearBumper = new Mesh(
        new BoxGeometry(profile.width * 0.78, 0.10, profile.bodyHeight * 0.44),
        materials.side,
    );
    rearBumper.position.set(0, -profile.length * 0.51, chassis.position.z - profile.bodyHeight * 0.02);
    rearBumper.userData.role = 'rear-bumper';
    group.add(rearBumper);
}

function addVehicleGlassPanels(group, profile, materials, chassis, cabin) {
    const topZ = chassis.position.z + (profile.bodyHeight / 2) + 0.09;
    const windscreen = createVehiclePanel(profile.width * 0.58, profile.length * 0.13, 0.05, materials.glass);
    windscreen.position.set(0, profile.cabinY + (profile.cabinLength * 0.34), topZ);
    group.add(windscreen);

    const rearGlass = createVehiclePanel(profile.width * 0.55, profile.length * 0.12, 0.05, materials.glass);
    rearGlass.position.set(0, profile.cabinY - (profile.cabinLength * 0.42), topZ - 0.03);
    group.add(rearGlass);

    [-1, 1].forEach((side) => {
        const sideGlass = new Mesh(
            new BoxGeometry(0.065, profile.cabinLength * 0.66, profile.cabinHeight * 0.54),
            materials.glass,
        );
        sideGlass.position.set(side * (profile.cabinWidth / 2 + 0.055), profile.cabinY - 0.05, cabin.position.z + 0.02);
        sideGlass.userData.role = 'side-glass';
        group.add(sideGlass);

        const pillar = new Mesh(
            new BoxGeometry(0.075, 0.10, profile.cabinHeight * 0.58),
            materials.body,
        );
        pillar.position.set(side * (profile.cabinWidth / 2 + 0.06), profile.cabinY + profile.cabinLength * 0.02, cabin.position.z + 0.01);
        pillar.userData.role = 'b-pillar';
        group.add(pillar);
    });
}

function addVehicleWheels(group, profile, materials) {
    [
        [-1, profile.frontWheelY],
        [1, profile.frontWheelY],
        [-1, profile.rearWheelY],
        [1, profile.rearWheelY],
    ].forEach(([side, y]) => {
        const wheel = createSideWheel(profile, materials.wheel);
        wheel.position.set(side * profile.wheelX, y, profile.rideHeight + profile.wheelRadius * 0.78);
        wheel.userData.role = 'wheel';
        group.add(wheel);

        const rim = createSideWheel({
            ...profile,
            wheelRadius: profile.wheelRadius * 0.58,
            wheelWidth: profile.wheelWidth + 0.018,
        }, materials.rim);
        rim.position.copy(wheel.position);
        rim.userData.role = 'rim';
        group.add(rim);
    });
}

function addVehicleLights(group, profile, materials, chassis) {
    const lightZ = chassis.position.z + (profile.bodyHeight * 0.14);
    [
        [-profile.width * 0.25, profile.length * 0.518, materials.headlight],
        [profile.width * 0.25, profile.length * 0.518, materials.headlight],
        [-profile.width * 0.30, -profile.length * 0.518, materials.tail],
        [profile.width * 0.30, -profile.length * 0.518, materials.tail],
    ].forEach(([x, y, material]) => {
        const light = new Mesh(new BoxGeometry(profile.width * 0.20, 0.07, 0.18), material);
        light.position.set(x, y, lightZ);
        light.userData.role = y > 0 ? 'headlight' : 'tail-light';
        group.add(light);
    });

    [
        [-profile.width * 0.25, profile.length * 0.545, materials.headlightGlow],
        [profile.width * 0.25, profile.length * 0.545, materials.headlightGlow],
        [-profile.width * 0.30, -profile.length * 0.545, materials.tailGlow],
        [profile.width * 0.30, -profile.length * 0.545, materials.tailGlow],
    ].forEach(([x, y, material]) => {
        const bulb = new Mesh(new SphereGeometry(profile.width * 0.075, 16, 8), material);
        bulb.scale.y = 0.42;
        bulb.position.set(x, y, lightZ + 0.02);
        group.add(bulb);
    });

    const rearBar = new Mesh(new BoxGeometry(profile.width * 0.58, 0.045, 0.07), materials.tailGlow);
    rearBar.position.set(0, -profile.length * 0.548, lightZ + 0.05);
    rearBar.userData.role = 'tail-light-bar';
    group.add(rearBar);

    [-1, 1].forEach((side) => {
        const sideMarker = new Mesh(new BoxGeometry(0.05, profile.length * 0.28, 0.055), materials.runningLight);
        sideMarker.position.set(side * (profile.width / 2 + 0.07), profile.length * 0.08, lightZ - 0.02);
        sideMarker.userData.role = 'side-marker';
        group.add(sideMarker);
    });
}

function addVehicleDetails(group, profile, materials, chassis, roof) {
    const stripe = new Mesh(new BoxGeometry(profile.width * 0.11, profile.length * 0.68, 0.04), materials.accent);
    stripe.position.set(0, profile.length * 0.02, chassis.position.z + (profile.bodyHeight / 2) + 0.08);
    stripe.userData.role = 'center-stripe';
    group.add(stripe);

    [-1, 1].forEach((side) => {
        const mirror = new Mesh(new BoxGeometry(0.16, 0.24, 0.09), materials.bodyHighlight);
        mirror.position.set(side * (profile.width / 2 + 0.14), profile.cabinY + (profile.cabinLength * 0.28), chassis.position.z + profile.bodyHeight * 0.64);
        mirror.userData.role = 'mirror';
        group.add(mirror);
    });

    if (profile.spoiler) {
        const spoiler = new Mesh(new BoxGeometry(profile.width * 0.82, 0.14, 0.11), materials.accent);
        spoiler.position.set(0, -profile.length * 0.48, roof.position.z + (profile.roofHeight / 2) + 0.03);
        spoiler.userData.role = 'spoiler';
        group.add(spoiler);
    }

    if (profile.rails) {
        [-1, 1].forEach((side) => {
            const rail = new Mesh(new BoxGeometry(0.06, profile.roofLength * 0.92, 0.10), materials.accent);
            rail.position.set(side * profile.roofWidth * 0.40, profile.roofY, roof.position.z + (profile.roofHeight / 2) + 0.09);
            rail.userData.role = 'roof-rail';
            group.add(rail);
        });
    }

    if (profile.evGlow) {
        [-1, 1].forEach((side) => {
            const glow = new Mesh(new BoxGeometry(0.055, profile.length * 0.62, 0.05), materials.glow);
            glow.position.set(side * (profile.width / 2 + 0.06), -0.04, chassis.position.z + profile.bodyHeight * 0.12);
            glow.userData.role = 'side-glow';
            group.add(glow);
        });
    }
}
