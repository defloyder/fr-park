const ROAD_CLASSES = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor', 'service'];
const MAJOR_ROAD_CLASSES = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary'];
const MINOR_ROAD_CLASSES = ['minor', 'service'];
const LINK_ROAD_CLASSES = ['motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link'];

const roadClassFilter = ['in', ['get', 'class'], ['literal', ROAD_CLASSES]];
const majorRoadClassFilter = ['in', ['get', 'class'], ['literal', MAJOR_ROAD_CLASSES]];
const minorRoadClassFilter = ['in', ['get', 'class'], ['literal', MINOR_ROAD_CLASSES]];
const linkRoadFilter = [
    'any',
    ['in', ['get', 'class'], ['literal', LINK_ROAD_CLASSES]],
    ['in', ['get', 'subclass'], ['literal', LINK_ROAD_CLASSES]],
    ['==', ['get', 'ramp'], 1],
    ['==', ['get', 'ramp'], true],
];
const bridgeFilter = [
    'any',
    ['==', ['get', 'brunnel'], 'bridge'],
    ['==', ['get', 'bridge'], true],
    ['>', ['coalesce', ['to-number', ['get', 'layer']], 0], 0],
];
const tunnelFilter = [
    'any',
    ['==', ['get', 'brunnel'], 'tunnel'],
    ['==', ['get', 'tunnel'], true],
    ['<', ['coalesce', ['to-number', ['get', 'layer']], 0], 0],
];

const ASPHALT_COLOR = '#8292A6';

const roadWidthFactor = [
    'match',
    ['get', 'class'],
    'motorway',
    1,
    'trunk',
    0.94,
    'primary',
    0.84,
    'secondary',
    0.72,
    'tertiary',
    0.62,
    'minor',
    0.42,
    'service',
    0.32,
    0.5,
];

const rampWidthFactor = [
    'match',
    ['get', 'class'],
    'motorway',
    0.62,
    'trunk',
    0.58,
    'primary',
    0.52,
    'secondary',
    0.48,
    0.42,
];

const majorSurfaceWidth = [
    'interpolate',
    ['linear'],
    ['zoom'],
    14,
    ['*', 18, roadWidthFactor],
    15,
    ['*', 31, roadWidthFactor],
    16,
    ['*', 52, roadWidthFactor],
    17,
    ['*', 78, roadWidthFactor],
    18,
    ['*', 112, roadWidthFactor],
    19,
    ['*', 156, roadWidthFactor],
    20,
    ['*', 212, roadWidthFactor],
];

const majorUnifierWidth = [
    'interpolate',
    ['linear'],
    ['zoom'],
    14,
    ['*', 42, roadWidthFactor],
    15,
    ['*', 72, roadWidthFactor],
    16,
    ['*', 118, roadWidthFactor],
    17,
    ['*', 176, roadWidthFactor],
    18,
    ['*', 252, roadWidthFactor],
    19,
    ['*', 352, roadWidthFactor],
    20,
    ['*', 480, roadWidthFactor],
];

const minorSurfaceWidth = [
    'interpolate',
    ['linear'],
    ['zoom'],
    15,
    7,
    16,
    11,
    17,
    17,
    18,
    24,
    19,
    34,
    20,
    46,
];

const rampSurfaceWidth = [
    'interpolate',
    ['linear'],
    ['zoom'],
    15,
    ['*', 16, rampWidthFactor],
    16,
    ['*', 26, rampWidthFactor],
    17,
    ['*', 40, rampWidthFactor],
    18,
    ['*', 58, rampWidthFactor],
    19,
    ['*', 82, rampWidthFactor],
    20,
    ['*', 110, rampWidthFactor],
];

function roadLineLayer({
    id,
    source,
    sourceLayer,
    filter,
    minzoom,
    color,
    width,
    opacity = 1,
    cap = 'square',
}) {
    return {
        id,
        type: 'line',
        source,
        'source-layer': sourceLayer,
        filter,
        minzoom,
        layout: {
            'line-cap': cap,
            'line-join': 'round',
        },
        paint: {
            'line-color': color,
            'line-width': width,
            'line-opacity': opacity,
        },
    };
}

export function createBaseRoadDetailLayers({ source, sourceLayer = 'transportation' }) {
    const majorFilter = ['all', majorRoadClassFilter, ['!', linkRoadFilter]];

    return [
        roadLineLayer({
            id: 'base_road_minor_surface',
            source,
            sourceLayer,
            filter: minorRoadClassFilter,
            minzoom: 15.2,
            color: ASPHALT_COLOR,
            width: minorSurfaceWidth,
        }),
        roadLineLayer({
            id: 'base_road_ramp_surface',
            source,
            sourceLayer,
            filter: linkRoadFilter,
            minzoom: 14.8,
            color: ASPHALT_COLOR,
            width: rampSurfaceWidth,
        }),
        roadLineLayer({
            id: 'base_road_major_unifier',
            source,
            sourceLayer,
            filter: majorFilter,
            minzoom: 14,
            color: ASPHALT_COLOR,
            width: majorUnifierWidth,
        }),
        roadLineLayer({
            id: 'base_road_major_surface',
            source,
            sourceLayer,
            filter: majorFilter,
            minzoom: 14,
            color: ASPHALT_COLOR,
            width: majorSurfaceWidth,
        }),
    ];
}
