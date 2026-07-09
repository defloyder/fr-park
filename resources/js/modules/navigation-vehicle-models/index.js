import { Group } from 'three';

import { createNavigationArrowModel } from './arrow-model.js';
import { createNavigationCarModel } from './car-model.js';
import { ARROW_ICON_ID } from './constants.js';

export function createNavigationVehicleModel({
    iconOptions = [],
    defaultIconId = ARROW_ICON_ID,
    modelLengthMeters = 6.2,
} = {}) {
    const group = new Group();
    const arrow = createNavigationArrowModel();
    const cars = iconOptions
        .filter((option) => option.id !== ARROW_ICON_ID)
        .map((option) => createNavigationCarModel(option.id, modelLengthMeters));

    arrow.name = 'vehicle-arrow';
    group.add(arrow, ...cars);
    applyNavigationVehicleStyle(group, defaultIconId);

    return group;
}

export function applyNavigationVehicleStyle(model, iconId) {
    const arrow = model.getObjectByName('vehicle-arrow');
    const isArrow = iconId === ARROW_ICON_ID;

    model.children.forEach((child) => {
        if (child.name?.startsWith('vehicle-car-')) {
            child.visible = !isArrow && child.userData.iconId === iconId;
        }
    });
    if (arrow) {
        arrow.visible = isArrow;
    }
}
