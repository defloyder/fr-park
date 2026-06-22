import { createBaseRoadDetailLayers } from '../../maps/layers/base-road-detail-layers';

const ROAD_DETAIL_BEFORE_LAYER_IDS = [
    'place-label',
    'road-name',
    'transit-labels',
    'poi-icons',
    'house-number',
];

export function addRoadDetails(
    map,
    {
        baseRoadSource = null,
        includeBaseRoadMarkings = true,
    } = {},
) {
    if (!map) {
        return;
    }

    const beforeId = getRoadDetailBeforeLayerId(map);

    if (baseRoadSource) {
        for (const layer of createBaseRoadDetailLayers({ source: baseRoadSource, includeMarkings: includeBaseRoadMarkings })) {
            if (map.getLayer(layer.id)) {
                continue;
            }

            map.addLayer(layer, beforeId);
        }
    }
}

function getRoadDetailBeforeLayerId(map) {
    return ROAD_DETAIL_BEFORE_LAYER_IDS.find((layerId) => map.getLayer(layerId)) ?? undefined;
}
