import { createRoadMarkingLayers } from './roadMarkingLayers';
import {
    createRoadMarkingsSource,
    ROAD_MARKINGS_SOURCE_ID,
    ROAD_MARKINGS_VECTOR_SOURCE_LAYER,
} from './roadMarkingSources';
import { addRoadMarkingImages } from './roadMarkingStyle';

const ROAD_MARKING_BEFORE_LAYER_IDS = [
    'place-label',
    'road-name',
    'transit-labels',
    'poi-icons',
    'house-number',
];

export function addRoadMarkings(map, { format = 'geojson' } = {}) {
    if (!map) {
        return;
    }

    addRoadMarkingImages(map);

    if (!map.getSource(ROAD_MARKINGS_SOURCE_ID)) {
        map.addSource(ROAD_MARKINGS_SOURCE_ID, createRoadMarkingsSource({ format }));
    }

    const beforeId = getRoadMarkingBeforeLayerId(map);
    const sourceLayer = format === 'vector' ? ROAD_MARKINGS_VECTOR_SOURCE_LAYER : null;

    for (const layer of createRoadMarkingLayers({ sourceLayer })) {
        if (map.getLayer(layer.id)) {
            continue;
        }

        map.addLayer(layer, beforeId);
    }
}

function getRoadMarkingBeforeLayerId(map) {
    return ROAD_MARKING_BEFORE_LAYER_IDS.find((layerId) => map.getLayer(layerId)) ?? undefined;
}
