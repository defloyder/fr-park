import {
    Color,
    MeshBasicMaterial,
    MeshStandardMaterial,
} from 'three';

export function createNavigationVehicleMaterials(profile) {
    const color = new Color(profile.bodyColor);
    const sideColor = color.clone().multiplyScalar(profile.sideShade);
    const accentColor = new Color(profile.accentColor);

    return {
        body: new MeshStandardMaterial({
            color,
            roughness: profile.roughness,
            metalness: profile.metalness,
            emissive: color.clone().multiplyScalar(profile.emissive),
        }),
        bodyHighlight: new MeshStandardMaterial({
            color: color.clone().multiplyScalar(1.18),
            roughness: profile.roughness * 0.9,
            metalness: Math.min(0.88, profile.metalness + 0.08),
            emissive: color.clone().multiplyScalar(profile.emissive * 0.75),
        }),
        side: new MeshStandardMaterial({
            color: sideColor,
            roughness: profile.roughness + 0.08,
            metalness: Math.min(0.9, profile.metalness + 0.08),
        }),
        glass: new MeshStandardMaterial({
            color: 0x071321,
            roughness: 0.08,
            metalness: 0.42,
            transparent: true,
            opacity: 0.92,
        }),
        wheel: new MeshStandardMaterial({
            color: 0x070b12,
            roughness: 0.36,
            metalness: 0.28,
        }),
        rim: new MeshStandardMaterial({
            color: profile.rimColor,
            roughness: 0.20,
            metalness: 0.82,
        }),
        accent: new MeshStandardMaterial({
            color: accentColor,
            roughness: 0.16,
            metalness: 0.70,
            emissive: accentColor.clone().multiplyScalar(0.16),
        }),
        glow: new MeshBasicMaterial({
            color: accentColor,
            transparent: true,
            opacity: 0.58,
            depthWrite: false,
        }),
        headlightGlow: new MeshBasicMaterial({
            color: 0xdff8ff,
            transparent: true,
            opacity: 0.96,
            depthWrite: false,
        }),
        tailGlow: new MeshBasicMaterial({
            color: 0xff1748,
            transparent: true,
            opacity: 0.98,
            depthWrite: false,
        }),
        runningLight: new MeshBasicMaterial({
            color: accentColor,
            transparent: true,
            opacity: 0.74,
            depthWrite: false,
        }),
        headlight: new MeshStandardMaterial({
            color: 0xeaf8ff,
            emissive: 0x6ed8ff,
            emissiveIntensity: 0.62,
            roughness: 0.12,
            metalness: 0.16,
        }),
        tail: new MeshStandardMaterial({
            color: 0xff264a,
            emissive: 0xff1e45,
            emissiveIntensity: 0.72,
            roughness: 0.18,
            metalness: 0.08,
        }),
    };
}
