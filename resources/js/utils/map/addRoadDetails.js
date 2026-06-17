import { createBaseRoadDetailLayers } from '../../maps/layers/base-road-detail-layers';
import { createRoadDetailLayers } from '../../maps/layers/road-detail-layers';
import {
    createRoadDetailsSource,
    ROAD_DETAILS_SOURCE_ID,
    ROAD_DETAILS_VECTOR_SOURCE_LAYER,
} from '../../maps/sources/road-detail-source';
import { addRoadMarkings } from '../../maps/roadMarkings/addRoadMarkings';

const ROAD_DETAIL_GORE_HATCH_IMAGE_ID = 'road-detail-gore-hatch';
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
        format = 'geojson',
        includeDataset = true,
        includeRoadMarkings = true,
        includeBaseRoadMarkings = true,
    } = {},
) {
    if (!map) {
        return;
    }

    const beforeId = getRoadDetailBeforeLayerId(map);

    addRoadDetailImages(map);

    if (baseRoadSource) {
        for (const layer of createBaseRoadDetailLayers({ source: baseRoadSource, includeMarkings: includeBaseRoadMarkings })) {
            if (map.getLayer(layer.id)) {
                continue;
            }

            map.addLayer(layer, beforeId);
        }
    }

    if (includeRoadMarkings) {
        addRoadMarkings(map, { format });
    }

    if (!includeDataset) {
        return;
    }

    if (!map.getSource(ROAD_DETAILS_SOURCE_ID)) {
        map.addSource(ROAD_DETAILS_SOURCE_ID, createRoadDetailsSource({ format }));
    }

    const sourceLayer = format === 'vector' ? ROAD_DETAILS_VECTOR_SOURCE_LAYER : null;

    for (const layer of createRoadDetailLayers({ sourceLayer })) {
        if (map.getLayer(layer.id)) {
            continue;
        }

        map.addLayer(layer, beforeId);
    }
}

function getRoadDetailBeforeLayerId(map) {
    return ROAD_DETAIL_BEFORE_LAYER_IDS.find((layerId) => map.getLayer(layerId)) ?? undefined;
}

function addRoadDetailImages(map) {
    addGoreHatchImage(map);
}

function addGoreHatchImage(map) {
    if (map.hasImage(ROAD_DETAIL_GORE_HATCH_IMAGE_ID)) return;

    const size = 24;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d');

    if (!context) {
        return;
    }

    context.clearRect(0, 0, size, size);
    context.strokeStyle = 'rgba(248, 250, 252, 0.72)';
    context.lineWidth = 2;

    for (let offset = -size; offset <= size * 2; offset += 8) {
        context.beginPath();
        context.moveTo(offset, size);
        context.lineTo(offset + size, 0);
        context.stroke();
    }

    map.addImage(ROAD_DETAIL_GORE_HATCH_IMAGE_ID, context.getImageData(0, 0, size, size), { pixelRatio: 2 });
}
