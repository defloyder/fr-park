import { createRoadDetailLayers } from '../layers/road-detail-layers';
import { createRoadDetailsSource, ROAD_DETAILS_SOURCE_ID } from '../sources/road-detail-source';

export const roadDetailStyle = {
    sourceId: ROAD_DETAILS_SOURCE_ID,
    source: createRoadDetailsSource(),
    layers: createRoadDetailLayers(),
};
