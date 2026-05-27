import { initParkingUi } from './modules/parking-form';
import { initParkingMap } from './modules/map';
import { initAdminPanel } from './modules/admin-panel';

initParkingUi();
initParkingMap();
initAdminPanel();

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').catch(() => {});
    });
}
