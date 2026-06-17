export const ROAD_MARKINGS_SOURCE_ID = 'road-markings';
export const ROAD_MARKINGS_GEOJSON_URL = '/data/road-markings/road-markings.geojson';
export const ROAD_MARKINGS_VECTOR_URL = 'pmtiles://road-markings.pmtiles';
export const ROAD_MARKINGS_VECTOR_SOURCE_LAYER = 'road_markings';

export function createRoadMarkingsSource({ format = 'geojson' } = {}) {
    if (format === 'vector') {
        return {
            type: 'vector',
            url: ROAD_MARKINGS_VECTOR_URL,
        };
    }

    return {
        type: 'geojson',
        data: ROAD_MARKINGS_GEOJSON_URL,
    };
}
