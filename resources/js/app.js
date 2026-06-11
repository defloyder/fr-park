import { initParkingUi } from './modules/parking-form';
import { initParkingMap } from './modules/map';
import { initAdminPanel } from './modules/admin-panel';

initParkingUi();
initParkingMap();
initAdminPanel();

if ('serviceWorker' in navigator) {
    window.addEventListener('load', async () => {
        try {
            const registration = await navigator.serviceWorker.register('/sw.js', {
                updateViaCache: 'none',
            });
            await registration.update();
        } catch {
            // The application remains usable without offline support.
        }
    });
}
