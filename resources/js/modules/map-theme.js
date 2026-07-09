export const MAP_LAYER_IDS = ['light', 'dark', 'satellite'];
const DEFAULT_MAP_LAYER_ID = 'light';

const MAP_UI_THEME_BY_LAYER = {
    light: {
        layerId: 'light',
        mapTone: 'light',
        uiTheme: 'dark',
        metaThemeColor: '#061018',
    },
    dark: {
        layerId: 'dark',
        mapTone: 'dark',
        uiTheme: 'light',
        metaThemeColor: '#eef7fb',
    },
    satellite: {
        layerId: 'satellite',
        mapTone: 'dark',
        uiTheme: 'light',
        metaThemeColor: '#eef7fb',
    },
};

export function normalizeMapLayerId(layerId) {
    return MAP_LAYER_IDS.includes(layerId) ? layerId : DEFAULT_MAP_LAYER_ID;
}

export function getMapUiTheme(layerId) {
    return MAP_UI_THEME_BY_LAYER[normalizeMapLayerId(layerId)];
}

export function applyMapUiTheme(layerId, { root = document.body, meta = document } = {}) {
    const theme = getMapUiTheme(layerId);

    if (root) {
        root.dataset.mapLayer = theme.layerId;
        root.dataset.mapTone = theme.mapTone;
        root.dataset.mapUiTheme = theme.uiTheme;
        root.classList.toggle('map-ui-theme-dark', theme.uiTheme === 'dark');
        root.classList.toggle('map-ui-theme-light', theme.uiTheme === 'light');
    }

    meta?.querySelector?.('meta[name="theme-color"]')
        ?.setAttribute('content', theme.metaThemeColor);

    return theme;
}
