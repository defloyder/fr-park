import fs from 'node:fs/promises';
import path from 'node:path';

const cdpPort = process.env.QA_CDP_PORT || '9222';
const baseUrl = process.env.QA_BASE_URL || 'http://127.0.0.1:8765';
const outputDir = path.resolve('artifacts/qa-road-detail');
const center = (process.env.QA_CENTER || '37.5965,55.5755').split(',').map(Number);
const zoom = Number(process.env.QA_ZOOM || 16.25);
const roadApi = process.env.QA_ROAD_API || '';

await fs.mkdir(outputDir, { recursive: true });

class CdpClient {
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
        return new Promise((resolve, reject) => {
            this.pending.set(id, { resolve, reject });
        });
    }

    close() {
        this.ws.close();
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
    if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    }
    return result.result?.value;
}

async function waitFor(client, expression, timeoutMs = 30000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
        try {
            if (await evaluate(client, expression)) return;
        } catch {
            // Navigation can briefly invalidate the execution context.
        }
        await sleep(250);
    }
    throw new Error(`Timeout waiting for ${expression}`);
}

const response = await fetch(`http://127.0.0.1:${cdpPort}/json/new?about:blank`, { method: 'PUT' });
if (!response.ok) throw new Error(`Unable to create browser tab: ${response.status}`);
const target = await response.json();
const client = new CdpClient(target.webSocketDebuggerUrl);
await client.connect();

try {
    await client.send('Page.enable');
    await client.send('Network.enable');
    await client.send('Network.setBypassServiceWorker', { bypass: true });
    await client.send('Emulation.setDeviceMetricsOverride', {
        width: 1228,
        height: 736,
        deviceScaleFactor: 1,
        mobile: false,
        screenWidth: 1228,
        screenHeight: 736,
    });
    await client.send('Page.navigate', { url: baseUrl });
    await waitFor(client, 'document.readyState === "complete"');
    await waitFor(client, 'document.body.classList.contains("is-map-ready") && Boolean(window.__qaMap)', 45000);

    await evaluate(client, `(() => {
        const darkButton = document.querySelector('[data-map-layer="dark"]');
        if (darkButton) darkButton.click();
        window.__qaMap.jumpTo({
            center: ${JSON.stringify(center)},
            zoom: ${zoom},
            bearing: 0,
            pitch: 0,
        });
        return true;
    })()`);
    await evaluate(client, `new Promise((resolve) => {
        window.__qaMap.once('idle', () => resolve(true));
        setTimeout(() => resolve(true), 15000);
    })`);
    if (roadApi) {
        await sleep(7000);
        await evaluate(client, `(async () => {
            const response = await fetch(${JSON.stringify(roadApi)});
            const collection = await response.json();
            window.__qaMap.getSource('road-details').setData(collection);
            return collection.features?.length || 0;
        })()`);
        await evaluate(client, `new Promise((resolve) => {
            window.__qaMap.once('idle', () => resolve(true));
            setTimeout(() => resolve(true), 15000);
        })`);
    }
    await waitFor(
        client,
        `window.__qaMap.getSource('road-details')?._data?.features?.some(
            (feature) => feature.properties?.detailType === 'road_geometry'
        )`,
        45000,
    );
    await sleep(2500);

    const result = await client.send('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: false,
        fromSurface: true,
    });
    const output = path.join(outputDir, 'latest-road-render.png');
    await fs.writeFile(output, Buffer.from(result.data, 'base64'));

    const arrowCoordinate = await evaluate(client, `(() => {
        const feature = window.__qaMap.querySourceFeatures('road-details')
            .find((item) => item.properties?.detailType === 'turn_lane_arrow');
        return feature?.geometry?.coordinates || null;
    })()`);
    if (arrowCoordinate) {
        await evaluate(client, `(() => {
            window.__qaMap.jumpTo({
                center: ${JSON.stringify(arrowCoordinate)},
                zoom: 18.2,
                bearing: 0,
                pitch: 0,
            });
            return true;
        })()`);
        await evaluate(client, `new Promise((resolve) => {
            window.__qaMap.once('idle', () => resolve(true));
            setTimeout(() => resolve(true), 15000);
        })`);
        await sleep(1500);
        const arrowResult = await client.send('Page.captureScreenshot', {
            format: 'png',
            captureBeyondViewport: false,
            fromSurface: true,
        });
        await fs.writeFile(
            path.join(outputDir, 'latest-road-arrows.png'),
            Buffer.from(arrowResult.data, 'base64'),
        );
    }

    const report = await evaluate(client, `(() => ({
        center: window.__qaMap.getCenter().toArray(),
        zoom: window.__qaMap.getZoom(),
        pairedFeatures: window.__qaMap.querySourceFeatures('road-details')
            .filter((feature) => Number(feature.properties?.pairedCarriageway) === 1).length,
        arrowFeatures: window.__qaMap.querySourceFeatures('road-details')
            .filter((feature) => feature.properties?.detailType === 'turn_lane_arrow').length,
        arrowCoordinate: ${JSON.stringify(arrowCoordinate)},
    }))()`);
    console.log(JSON.stringify({ output, report }, null, 2));
} finally {
    client.close();
}
