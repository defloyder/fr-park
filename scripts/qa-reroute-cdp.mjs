import fs from 'node:fs/promises';
import path from 'node:path';

const port = process.env.QA_CDP_PORT || '9222';
const outputDir = path.resolve(process.env.QA_OUTPUT_DIR || 'artifacts/qa');

class Client {
    constructor(url) {
        this.url = url;
        this.id = 0;
        this.pending = new Map();
        this.listeners = new Map();
    }

    async connect() {
        this.ws = new WebSocket(this.url);
        await new Promise((resolve, reject) => {
            this.ws.addEventListener('open', resolve, { once: true });
            this.ws.addEventListener('error', reject, { once: true });
        });
        this.ws.addEventListener('message', (event) => {
            const message = JSON.parse(event.data);
            if (message.id) {
                const pending = this.pending.get(message.id);
                if (!pending) return;
                this.pending.delete(message.id);
                if (message.error) pending.reject(new Error(JSON.stringify(message.error)));
                else pending.resolve(message.result);
                return;
            }
            for (const listener of this.listeners.get(message.method) || []) listener(message.params || {});
        });
    }

    send(method, params = {}) {
        const id = ++this.id;
        this.ws.send(JSON.stringify({ id, method, params }));
        return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
    }

    on(method, listener) {
        const listeners = this.listeners.get(method) || [];
        listeners.push(listener);
        this.listeners.set(method, listeners);
    }
}

async function evaluate(client, expression) {
    const result = await client.send('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
    });
    return result.result?.value;
}

const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
let client;

for (const target of targets.filter((item) => item.type === 'page' && item.url.startsWith('https://park.auralith.ru/'))) {
    const candidate = new Client(target.webSocketDebuggerUrl);
    await candidate.connect();
    await candidate.send('Runtime.enable');
    if (await evaluate(candidate, 'document.body.classList.contains("is-navigation-mode")')) {
        client = candidate;
        break;
    }
    candidate.ws.close();
}

if (!client) throw new Error('Active navigation tab was not found');

await client.send('Network.enable');
const report = {
    startedAt: new Date().toISOString(),
    before: await evaluate(client, `(() => ({
        following: document.body.classList.contains('is-navigation-following'),
        speed: document.querySelector('[data-navigation-speed]')?.textContent?.trim() || '',
        instruction: document.querySelector('[data-navigation-instruction]')?.textContent?.trim() || '',
    }))()`),
    request: null,
    response: null,
};

let requestResolve;
const requestSeen = new Promise((resolve) => {
    requestResolve = resolve;
});
const requestStarts = new Map();

client.on('Network.requestWillBeSent', (params) => {
    if (!params.request.url.includes('/api/routes/driving')) return;
    requestStarts.set(params.requestId, Date.now());
    report.request = {
        observedAfterMs: Date.now() - startedAt,
        url: params.request.url,
    };
    requestResolve();
});
client.on('Network.responseReceived', (params) => {
    if (!params.response.url.includes('/api/routes/driving')) return;
    report.response = {
        status: params.response.status,
        requestDurationMs: Date.now() - (requestStarts.get(params.requestId) || Date.now()),
        observedAfterMs: Date.now() - startedAt,
    };
});

const startedAt = Date.now();
await client.send('Emulation.setGeolocationOverride', {
    latitude: 55.77000,
    longitude: 37.59000,
    accuracy: 8,
    heading: 270,
    speed: 13.89,
});

await Promise.race([
    requestSeen,
    new Promise((resolve) => setTimeout(resolve, 15000)),
]);
await new Promise((resolve) => setTimeout(resolve, 6000));

report.afterDeviation = await evaluate(client, `(() => ({
    following: document.body.classList.contains('is-navigation-following'),
    speed: document.querySelector('[data-navigation-speed]')?.textContent?.trim() || '',
    instruction: document.querySelector('[data-navigation-instruction]')?.textContent?.trim() || '',
    maneuverDistance: document.querySelector('[data-navigation-maneuver-distance]')?.textContent?.trim() || '',
}))()`);

const screenshot = await client.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false,
    fromSurface: true,
});
await fs.writeFile(path.join(outputDir, '15-mobile-navigation-rerouted.png'), Buffer.from(screenshot.data, 'base64'));

const unavailableStartedAt = Date.now();
await client.send('Emulation.setGeolocationOverride', {});
await new Promise((resolve) => setTimeout(resolve, 7000));
report.afterGpsError = await evaluate(client, `(() => ({
    observedForMs: ${Date.now()} - ${unavailableStartedAt},
    following: document.body.classList.contains('is-navigation-following'),
    speed: document.querySelector('[data-navigation-speed]')?.textContent?.trim() || '',
    instruction: document.querySelector('[data-navigation-instruction]')?.textContent?.trim() || '',
    statusText: document.querySelector('#status-panel')?.textContent?.trim() || '',
}))()`);
report.finishedAt = new Date().toISOString();

await fs.writeFile(path.join(outputDir, 'reroute-report.json'), JSON.stringify(report, null, 2));
client.ws.close();
console.log(JSON.stringify(report, null, 2));
