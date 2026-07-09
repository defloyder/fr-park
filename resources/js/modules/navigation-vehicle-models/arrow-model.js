import {
    ExtrudeGeometry,
    Group,
    Mesh,
    MeshStandardMaterial,
    Shape,
} from 'three';

export function createNavigationArrowModel() {
    const group = new Group();
    const sideMaterial = new MeshStandardMaterial({
        color: 0x17224c,
        roughness: 0.24,
        metalness: 0.62,
    });
    const topMaterial = new MeshStandardMaterial({
        color: 0x1fa8ff,
        roughness: 0.14,
        metalness: 0.72,
        emissive: 0x063b7e,
        emissiveIntensity: 0.18,
    });
    const shape = new Shape();
    shape.moveTo(0, 3.45);
    shape.lineTo(1.55, -2.20);
    shape.lineTo(0, -1.34);
    shape.lineTo(-1.55, -2.20);
    shape.closePath();

    const geometry = new ExtrudeGeometry(shape, {
        depth: 0.50,
        bevelEnabled: true,
        bevelSize: 0.08,
        bevelThickness: 0.10,
        bevelSegments: 4,
    });
    geometry.translate(0, 0, 0.20);

    const arrow = new Mesh(geometry, [topMaterial, sideMaterial]);
    arrow.userData.role = 'arrow';
    group.add(arrow);

    return group;
}
