import {
    BufferGeometry,
    CylinderGeometry,
    ExtrudeGeometry,
    Float32BufferAttribute,
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

export function createTaperedVehiclePart({
    bottomWidth,
    bottomLength,
    topWidth,
    topLength,
    height,
    material,
}) {
    const bw = bottomWidth / 2;
    const bl = bottomLength / 2;
    const tw = topWidth / 2;
    const tl = topLength / 2;
    const hz = height / 2;
    const geometry = new BufferGeometry();

    geometry.setAttribute('position', new Float32BufferAttribute([
        -bw, -bl, -hz,
        bw, -bl, -hz,
        bw, bl, -hz,
        -bw, bl, -hz,
        -tw, -tl, hz,
        tw, -tl, hz,
        tw, tl, hz,
        -tw, tl, hz,
    ], 3));
    geometry.setIndex([
        0, 1, 2, 0, 2, 3,
        4, 6, 5, 4, 7, 6,
        0, 4, 5, 0, 5, 1,
        1, 5, 6, 1, 6, 2,
        2, 6, 7, 2, 7, 3,
        3, 7, 4, 3, 4, 0,
    ]);
    geometry.computeVertexNormals();

    return new Mesh(geometry, material);
}

export function createSideWheel(profile, material) {
    const wheel = new Mesh(
        new CylinderGeometry(profile.wheelRadius, profile.wheelRadius, profile.wheelWidth, 32),
        material,
    );
    wheel.rotation.z = Math.PI / 2;

    return wheel;
}
