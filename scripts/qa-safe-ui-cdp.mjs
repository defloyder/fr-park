import fs from 'node:fs/promises';
import path from 'node:path';

const port = process.env.QA_CDP_PORT || '9222';
const baseUrl = process.env.QA_BASE_URL || 'https://park.auralith.ru';
const outputDir = path.resolve(process.env.QA_OUTPUT_DIR || 'artifacts/qa');

class Client {
    constructor(url) {
        this.url = url;
        this.id = 0;
        this.pending = new Map();
    }

    async connect() {
        this.ws = new WebSocket(this.url);
        await new Promise((resolve, reject) => {
            this.ws.addEventListener('open', resolve, { once: true });
            this.ws.addEventListener('error', reject, { once: true });
        });
        this.ws.addEventListener('message', (event) => {
            const message = JSON.parse(event.data);
            if (!message.id) return;
            const pending = this.pending.get(message.id);
            if (!pending) return;
            this.pending.delete(message.id);
            if (message.error) pending.reject(new Error(JSON.stringify(message.error)));
            else pending.resolve(message.result);
        });
    }

    send(method, params = {}) {
        const id = ++this.id;
        this.ws.send(JSON.stringify({ id, method, params }));
        return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
    }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function evaluate(client, expression) {
    const result = await client.send('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
        userGesture: true,
    });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result?.value;
}

async function waitFor(client, expression, timeoutMs = 20000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
        if (await evaluate(client, expression).catch(() => false)) return;
        await sleep(200);
    }
    throw new Error(`Timeout: ${expression}`);
}

async function navigate(client, url) {
    await client.send('Page.navigate', { url });
    await waitFor(client, 'document.readyState === "complete"', 30000);
}

async function screenshot(client, name) {
    const result = await client.send('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: false,
        fromSurface: true,
    });
    await fs.writeFile(path.join(outputDir, name), Buffer.from(result.data, 'base64'));
}

const targetResponse = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' });
const target = await targetResponse.json();
const client = new Client(target.webSocketDebuggerUrl);
await client.connect();
await client.send('Runtime.enable');
await client.send('Page.enable');
await client.send('Network.enable');
await client.send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
});

const report = {};

await navigate(client, `${baseUrl}/aura-vault-7f3c`);
await waitFor(client, 'document.querySelectorAll("[data-admin-rows] tr").length > 0');
await waitFor(client, 'document.querySelectorAll("[data-admin-users] tr").length > 0');

report.admin = await evaluate(client, `(async () => {
    const search = document.querySelector('[data-admin-search]');
    const status = document.querySelector('[data-admin-status]');
    const countRows = () => document.querySelectorAll('[data-admin-rows] tr').length;
    const initialRows = countRows();

    search.value = 'Бауман';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    const searchedRows = countRows();

    search.value = '';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    status.value = 'verified';
    status.dispatchEvent(new Event('change', { bubbles: true }));
    const verifiedRows = countRows();

    status.value = '';
    status.dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelector('[data-admin-row-check]')?.click();
    const selectedText = document.querySelector('[data-admin-selected-count]')?.textContent?.trim() || '';

    document.querySelector('[data-admin-edit]')?.click();
    const editor = document.querySelector('[data-admin-editor]');
    const editorData = {
        visible: editor ? !editor.classList.contains('hidden') : false,
        id: editor?.elements.id?.value || '',
        title: editor?.elements.title?.value || '',
        address: editor?.elements.address?.value || '',
        status: editor?.elements.availability_status?.value || '',
        photoCount: document.querySelectorAll('[data-admin-photo-preview] img').length,
    };

    document.querySelector('[data-admin-open-map]')?.click();
    const mapModal = document.querySelector('[data-admin-map-modal]');
    const mapData = {
        visible: mapModal ? !mapModal.classList.contains('hidden') : false,
        iframeSrc: mapModal?.querySelector('iframe')?.src || '',
    };
    document.querySelector('[data-admin-close-map]')?.click();

    const exportResponse = await fetch('/api/parking-spots/export');
    const exportBlob = await exportResponse.blob();
    const roleButtons = [...document.querySelectorAll('[data-admin-user]')];

    return {
        initialRows,
        searchedRows,
        verifiedRows,
        selectedText,
        editor: editorData,
        map: mapData,
        users: document.querySelectorAll('[data-admin-users] tr').length,
        protectedRootAdmins: roleButtons.filter((button) => button.disabled).length,
        export: {
            status: exportResponse.status,
            contentType: exportResponse.headers.get('content-type'),
            bytes: exportBlob.size,
        },
    };
})()`);

await navigate(client, `${baseUrl}/`);
await waitFor(client, 'document.querySelector(".maplibregl-canvas")');
await waitFor(client, 'document.querySelectorAll(".spot-list__item").length > 0');
if (await evaluate(client, 'document.body.classList.contains("is-navigation-mode")')) {
    await evaluate(client, `document.querySelector('[data-action="start-navigation"]')?.click()`);
    await waitFor(client, '!document.body.classList.contains("is-navigation-mode")');
}
await evaluate(client, `document.querySelector('[data-action="open-list"]').click()`);
await evaluate(client, `document.querySelector('.spot-list__content').click()`);
await waitFor(client, '!document.querySelector("#selected-spot-card").classList.contains("hidden")');
await sleep(1000);

report.spotCardDesktop = await evaluate(client, `(() => {
    const card = document.querySelector('#selected-spot-card');
    const frame = card.querySelector('.spot-card__photo');
    const images = [...card.querySelectorAll('.photo-carousel img')];
    const frameRect = frame?.getBoundingClientRect();
    return {
        title: card.querySelector('h2')?.textContent?.trim() || '',
        frame: frameRect ? { width: Math.round(frameRect.width), height: Math.round(frameRect.height) } : null,
        images: images.map((image) => ({
            src: image.src,
            complete: image.complete,
            naturalWidth: image.naturalWidth,
            naturalHeight: image.naturalHeight,
            renderedWidth: Math.round(image.getBoundingClientRect().width),
            renderedHeight: Math.round(image.getBoundingClientRect().height),
            objectFit: getComputedStyle(image).objectFit,
        })),
        cardOverflow: card.scrollHeight > card.clientHeight,
    };
})()`);
await screenshot(client, '16-desktop-spot-card.png');

await client.send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 3,
    mobile: true,
    screenWidth: 390,
    screenHeight: 844,
});
await client.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await sleep(500);
report.spotCardMobile = await evaluate(client, `(() => {
    const card = document.querySelector('#selected-spot-card');
    const frame = card.querySelector('.spot-card__photo');
    const frameRect = frame?.getBoundingClientRect();
    const rect = card.getBoundingClientRect();
    return {
        frame: frameRect ? { width: Math.round(frameRect.width), height: Math.round(frameRect.height) } : null,
        card: { top: Math.round(rect.top), bottom: Math.round(rect.bottom), height: Math.round(rect.height) },
        viewport: { width: innerWidth, height: innerHeight },
        horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 2,
        verticalScrollInsideCard: card.scrollHeight > card.clientHeight,
    };
})()`);
await screenshot(client, '17-mobile-spot-card.png');

await evaluate(client, `document.querySelector('.spot-card__close')?.click()`);
await evaluate(client, `document.querySelector('[data-action="open-add"]').click()`);
await waitFor(client, '!document.querySelector("#add-spot-sheet").classList.contains("hidden")');
report.addForm = await evaluate(client, `(() => {
    const form = document.querySelector('#add-spot-form');
    const camera = document.querySelector('#photo-camera-input');
    const file = document.querySelector('#photo-file-input');
    return {
        requiredFields: [...form.querySelectorAll('[required]')].map((input) => input.name || input.id),
        cameraCapture: camera?.getAttribute('capture') || null,
        cameraAccept: camera?.accept || '',
        multipleFiles: Boolean(file?.multiple),
        fileAccept: file?.accept || '',
        visible: !document.querySelector('#add-spot-sheet').classList.contains('hidden'),
    };
})()`);
await screenshot(client, '18-mobile-add-form.png');

await client.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
});
await navigate(client, `${baseUrl}/`);
await waitFor(client, 'navigator.serviceWorker?.controller');
await sleep(1000);
await client.send('Network.emulateNetworkConditions', {
    offline: true,
    latency: 0,
    downloadThroughput: 0,
    uploadThroughput: 0,
});
await client.send('Page.reload', { ignoreCache: false });
await sleep(5000);
report.offline = await evaluate(client, `(() => ({
    readyState: document.readyState,
    title: document.title,
    serviceWorkerControlled: Boolean(navigator.serviceWorker?.controller),
    stylesheets: document.styleSheets.length,
    mapCanvas: Boolean(document.querySelector('.maplibregl-canvas')),
    mapFallbackVisible: Boolean(document.querySelector('#map-fallback:not(.hidden)')),
    parkingItems: document.querySelectorAll('.spot-list__item').length,
    bodyTextLength: document.body?.innerText?.length || 0,
}))()`);
await screenshot(client, '19-mobile-offline.png');
await client.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
});

await fs.writeFile(path.join(outputDir, 'safe-ui-report.json'), JSON.stringify(report, null, 2));
client.ws.close();
console.log(JSON.stringify(report, null, 2));
