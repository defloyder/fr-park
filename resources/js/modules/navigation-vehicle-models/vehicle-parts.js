import {
    CylinderGeometry,
    ExtrudeGeometry,
    Mesh,
    Shape,
} from 'three';

export function createRoundedVehiclePart(width, length, height, radius, material) {
    const x = width / 2;
    const y = length / 2;
    const r = Math.min(radius, x, y);
    const shape = new Shape();

    shape.moveTo(-x + r, -y);
    shape.lineTo(x - r, -y);
    shape.quadraticCurveTo(x, -y, x, -y + r);
    shape.lineTo(x, y - r);
    shape.quadraticCurveTo(x, y, x - r, y);
    shape.lineTo(-x + r, y);
    shape.quadraticCurveTo(-x, y, -x, y - r);
    shape.lineTo(-x, -y + r);
    shape.quadraticCurveTo(-x, -y, -x + r, -y);

    const geometry = new ExtrudeGeometry(shape, {
        depth: height,
        bevelEnabled: true,
        bevelSize: Math.min(0.08, height * 0.35),
        bevelThickness: Math.min(0.08, height * 0.35),
        bevelSegments: 4,
    });
    geometry.translate(0, 0, -height / 2);

    return new Mesh(geometry, material);
}

export function createVehiclePanel(width, length, height, material) {
    return createRoundedVehiclePart(width, length, height, Math.min(width, length) * 0.18, material);
}

export function createSideWheel(profile, material) {
    const wheel = new Mesh(
        new CylinderGeometry(profile.wheelRadius, profile.wheelRadius, profile.wheelWidth, 32),
        material,
    );
    wheel.rotation.z = Math.PI / 2;

    return wheel;
}
