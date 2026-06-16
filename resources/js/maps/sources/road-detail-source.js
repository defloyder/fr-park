export const ROAD_DETAILS_SOURCE_ID = 'road-details';
export const ROAD_DETAILS_GEOJSON_URL = '/data/road-details/road-details.geojson';
export const ROAD_DETAILS_VECTOR_URL = 'pmtiles://road-details.pmtiles';
export const ROAD_DETAILS_VECTOR_SOURCE_LAYER = 'road_details';

export function createRoadDetailsSource({ format = 'geojson' } = {}) {
    if (format === 'vector') {
        return {
            type: 'vector',
            url: ROAD_DETAILS_VECTOR_URL,
        };
    }

    return {
        type: 'geojson',
        data: ROAD_DETAILS_GEOJSON_URL,
    };
}
