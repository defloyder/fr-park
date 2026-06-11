import fs from 'node:fs/promises';
import path from 'node:path';

const baseUrl = process.env.QA_BASE_URL || 'https://park.auralith.ru';
const email = process.env.QA_EMAIL;
const password = process.env.QA_PASSWORD;
const cdpPort = process.env.QA_CDP_PORT || '9222';
const outputDir = path.resolve(process.env.QA_OUTPUT_DIR || 'artifacts/qa');

if (!email || !password) {
    throw new Error('QA_EMAIL and QA_PASSWORD are required');
}

await fs.mkdir(outputDir, { recursive: true });

class CdpClient {
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
            for (const listener of this.listeners.get(message.method) || []) {
                listener(message.params || {});
            }
        });
    }

    send(method, params = {}) {
        const id = ++this.id;
        this.ws.send(JSON.stringify({ id, method, params }));
        return new Promise((resolve, reject) => {
            this.pending.set(id, { resolve, reject });
        });
    }

    on(method, listener) {
        const listeners = this.listeners.get(method) || [];
        listeners.push(listener);
        this.listeners.set(method, listeners);
    }

    close() {
        this.ws.close();
    }
}

async function createPage() {
    const response = await fetch(`http://127.0.0.1:${cdpPort}/json/new?about:blank`, {
        method: 'PUT',
    });
    if (!response.ok) throw new Error(`Unable to create Chrome tab: ${response.status}`);
    const target = await response.json();
    const client = new CdpClient(target.webSocketDebuggerUrl);
    await client.connect();
    return client;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function evaluate(client, expression, { awaitPromise = true } = {}) {
    const result = await client.send('Runtime.evaluate', {
        expression,
        awaitPromise,
        returnByValue: true,
        userGesture: true,
    });
    if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    }
    return result.result?.value;
}

async function waitFor(client, expression, timeoutMs = 15000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
        try {
            if (await evaluate(client, expression)) return;
        } catch {
            // The page may be navigating.
        }
        await sleep(200);
    }
    throw new Error(`Timeout waiting for: ${expression}`);
}

async function navigate(client, url) {
    await client.send('Page.navigate', { url });
    await waitFor(client, 'document.readyState === "complete"', 30000);
}

async function setViewport(client, width, height, mobile = false, scale = 1) {
    await client.send('Emulation.setDeviceMetricsOverride', {
        width,
        height,
        deviceScaleFactor: scale,
        mobile,
        screenWidth: width,
        screenHeight: height,
    });
    await client.send('Emulation.setTouchEmulationEnabled', {
        enabled: mobile,
        maxTouchPoints: mobile ? 5 : 1,
    });
}

async function screenshot(client, name) {
    const result = await client.send('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: false,
        fromSurface: true,
    });
    await fs.writeFile(path.join(outputDir, name), Buffer.from(result.data, 'base64'));
}

async function collectLayout(client) {
    return evaluate(client, `(() => {
        const visible = (element) => {
            const style = getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return style.display !== 'none' && style.visibility !== 'hidden'
                && !element.classList.contains('hidden') && rect.width > 0 && rect.height > 0;
        };
        const viewport = { width: innerWidth, height: innerHeight };
        const overflow = [...document.querySelectorAll('body *')]
            .filter(visible)
            .map((element) => {
                const rect = element.getBoundingClientRect();
                return {
                    selector: element.id ? '#' + element.id : element.className
                        ? '.' + String(element.className).trim().replace(/\\s+/g, '.')
                        : element.tagName.toLowerCase(),
                    left: Math.round(rect.left),
                    right: Math.round(rect.right),
                    top: Math.round(rect.top),
                    bottom: Math.round(rect.bottom),
                };
            })
            .filter((item) => item.left < -2 || item.right > innerWidth + 2)
            .slice(0, 30);
        const controls = [...document.querySelectorAll('button, a, input, select, textarea')]
            .filter(visible)
            .map((element) => {
                const rect = element.getBoundingClientRect();
                return {
                    text: (element.getAttribute('aria-label') || element.textContent || element.name || '').trim().slice(0, 80),
                    tag: element.tagName,
                    width: Math.round(rect.width),
                    height: Math.round(rect.height),
                };
            });
        return {
            viewport,
            bodySize: { width: document.body.scrollWidth, height: document.body.scrollHeight },
            horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 2,
            overflow,
            smallTouchTargets: controls.filter((item) => item.width < 44 || item.height < 44).slice(0, 50),
        };
    })()`);
}

async function click(client, selector) {
    return evaluate(client, `(() => {
        const element = document.querySelector(${JSON.stringify(selector)});
        if (!element) return false;
        element.click();
        return true;
    })()`);
}

const client = await createPage();
const report = {
    startedAt: new Date().toISOString(),
    baseUrl,
    browser: {},
    console: [],
    exceptions: [],
    failedRequests: [],
    httpErrors: [],
    routeRequests: [],
    scenarios: {},
};
const routeRequestStarts = new Map();

client.on('Runtime.consoleAPICalled', (params) => {
    report.console.push({
        type: params.type,
        text: params.args?.map((arg) => arg.value ?? arg.description ?? '').join(' ').slice(0, 500),
    });
});
client.on('Runtime.exceptionThrown', (params) => {
    report.exceptions.push(params.exceptionDetails?.exception?.description || params.exceptionDetails?.text);
});
client.on('Network.loadingFailed', (params) => {
    report.failedRequests.push({
        errorText: params.errorText,
        type: params.type,
        canceled: params.canceled || false,
    });
});
client.on('Network.responseReceived', (params) => {
    if (params.response.url.includes('/api/routes/driving')) {
        const startedAt = routeRequestStarts.get(params.requestId);
        report.routeRequests.push({
            url: params.response.url,
            status: params.response.status,
            durationMs: startedAt ? Math.round(performance.now() - startedAt) : null,
            observedAt: new Date().toISOString(),
        });
    }
    if (params.response.status >= 400) {
        report.httpErrors.push({
            status: params.response.status,
            url: params.response.url,
            type: params.type,
        });
    }
});
client.on('Network.requestWillBeSent', (params) => {
    if (params.request.url.includes('/api/routes/driving')) {
        routeRequestStarts.set(params.requestId, performance.now());
    }
});

try {
    await client.send('Runtime.enable');
    await client.send('Page.enable');
    await client.send('Network.enable');
    await client.send('Log.enable');
    report.browser = await client.send('Browser.getVersion');

    await client.send('Browser.setPermission', {
        permission: { name: 'geolocation' },
        setting: 'granted',
        origin: baseUrl,
    });
    await client.send('Emulation.setGeolocationOverride', {
        latitude: 55.75222,
        longitude: 37.61556,
        accuracy: 8,
        heading: 90,
        speed: 0,
    });

    await setViewport(client, 1440, 1000, false, 1);
    await navigate(client, `${baseUrl}/`);
    await waitFor(client, 'document.querySelector("#parking-map") && !document.querySelector(".map-canvas").classList.contains("hidden")');
    await sleep(5000);
    report.scenarios.desktopHome = await collectLayout(client);
    report.scenarios.desktopHome.title = await evaluate(client, 'document.title');
    report.scenarios.desktopHome.bodyClass = await evaluate(client, 'document.body.className');
    report.scenarios.desktopHome.mapCanvasCount = await evaluate(client, 'document.querySelectorAll(".maplibregl-canvas").length');
    await screenshot(client, '01-desktop-home.png');

    await click(client, '[data-action="open-list"]');
    await waitFor(client, '!document.querySelector("#spot-list").classList.contains("hidden")');
    await sleep(1500);
    report.scenarios.desktopList = await collectLayout(client);
    report.scenarios.desktopList.items = await evaluate(client, 'document.querySelectorAll(".spot-list__item").length');
    await screenshot(client, '02-desktop-list.png');

    await click(client, '[data-action="open-profile"]');
    await waitFor(client, '!document.querySelector("#profile-panel").classList.contains("hidden")');
    await screenshot(client, '03-desktop-login.png');
    await evaluate(client, `(() => {
        const form = document.querySelector('#auth-form');
        form.elements.email.value = ${JSON.stringify(email)};
        form.elements.password.value = ${JSON.stringify(password)};
        form.requestSubmit();
    })()`);
    await waitFor(client, 'document.querySelector("#auth-form").classList.contains("hidden")', 20000);
    report.scenarios.login = await evaluate(client, `(async () => {
        const response = await fetch('/account/session', { headers: { Accept: 'application/json' } });
        const data = await response.json();
        return {
            status: response.status,
            authenticated: Boolean(data.user),
            isAdmin: Boolean(data.user?.is_admin),
            favoriteCount: data.favorite_ids?.length || 0,
            personalPlaceCount: data.personal_places?.length || 0,
        };
    })()`);
    await screenshot(client, '04-desktop-profile-authenticated.png');

    await navigate(client, `${baseUrl}/aura-vault-7f3c`);
    await waitFor(client, 'document.querySelector("[data-admin-app]")', 20000);
    await waitFor(client, 'document.querySelectorAll("[data-admin-rows] tr").length > 0', 20000);
    await sleep(1500);
    report.scenarios.adminDesktop = await collectLayout(client);
    report.scenarios.adminDesktop.data = await evaluate(client, `(async () => {
        const [spotsResponse, usersResponse] = await Promise.all([
            fetch('/aura-vault-7f3c/spots', { headers: { Accept: 'application/json' } }),
            fetch('/aura-vault-7f3c/users', { headers: { Accept: 'application/json' } }),
        ]);
        const spotsData = await spotsResponse.json();
        const usersData = await usersResponse.json();
        return {
            spotsStatus: spotsResponse.status,
            usersStatus: usersResponse.status,
            spots: spotsData.data || [],
            usersCount: usersData.data?.length || 0,
        };
    })()`);
    const spots = report.scenarios.adminDesktop.data.spots;
    report.scenarios.adminDesktop.spotCount = spots.length;
    report.scenarios.adminDesktop.userCount = report.scenarios.adminDesktop.data.usersCount;
    await screenshot(client, '05-admin-desktop.png');

    await click(client, '[data-admin-theme-option="dark"]');
    await sleep(400);
    report.scenarios.adminDesktop.darkTheme = await evaluate(client, 'document.querySelector("[data-admin-app]").dataset.adminTheme');
    await screenshot(client, '06-admin-desktop-dark.png');

    await setViewport(client, 390, 844, true, 3);
    await sleep(700);
    report.scenarios.adminMobile = await collectLayout(client);
    await screenshot(client, '07-admin-mobile.png');

    const photoUrls = [...new Set(spots.flatMap((spot) => {
        const photos = Array.isArray(spot.photo_urls) ? spot.photo_urls : [];
        return photos.length ? photos : (spot.photo_url ? [spot.photo_url] : []);
    }).filter(Boolean))];
    report.scenarios.photos = await evaluate(client, `(async () => {
        const urls = ${JSON.stringify(photoUrls)};
        const results = [];
        for (const url of urls) {
            const result = await new Promise((resolve) => {
                const image = new Image();
                const startedAt = performance.now();
                image.onload = () => resolve({
                    url,
                    ok: true,
                    width: image.naturalWidth,
                    height: image.naturalHeight,
                    ratio: Number((image.naturalWidth / image.naturalHeight).toFixed(3)),
                    durationMs: Math.round(performance.now() - startedAt),
                });
                image.onerror = () => resolve({ url, ok: false, durationMs: Math.round(performance.now() - startedAt) });
                image.src = url;
            });
            results.push(result);
        }
        return results;
    })()`, { awaitPromise: true });

    await navigate(client, `${baseUrl}/`);
    await waitFor(client, 'document.querySelector(".maplibregl-canvas")', 20000);
    await sleep(2500);
    await setViewport(client, 390, 844, true, 3);
    report.scenarios.mobileHome = await collectLayout(client);
    await screenshot(client, '08-mobile-home.png');

    await click(client, '[data-action="open-list"]');
    await waitFor(client, '!document.querySelector("#spot-list").classList.contains("hidden")');
    await sleep(600);
    report.scenarios.mobileList = await collectLayout(client);
    await screenshot(client, '09-mobile-list.png');

    await click(client, '[data-action="open-profile"]');
    await waitFor(client, '!document.querySelector("#profile-panel").classList.contains("hidden")');
    report.scenarios.pwaUi = await evaluate(client, `(() => {
        const manifest = document.querySelector('link[rel="manifest"]');
        const installButton = document.querySelector('[data-action="install-web-app"]');
        const note = document.querySelector('[data-install-app-note]');
        return {
            manifestHref: manifest?.href || null,
            serviceWorkerSupported: 'serviceWorker' in navigator,
            standalone: matchMedia('(display-mode: standalone)').matches,
            installButtonDisabled: installButton?.disabled ?? null,
            installButtonVisible: installButton ? getComputedStyle(installButton).display !== 'none' : false,
            installNote: note?.textContent?.trim() || '',
        };
    })()`);
    report.scenarios.pwaUi.registration = await evaluate(client, `(async () => {
        const registration = await navigator.serviceWorker?.ready;
        return registration ? {
            scope: registration.scope,
            activeState: registration.active?.state || null,
            scriptURL: registration.active?.scriptURL || null,
        } : null;
    })()`);
    report.scenarios.pwaUi.manifest = await client.send('Page.getAppManifest');
    report.scenarios.pwaUi.installabilityErrors = await client.send('Page.getInstallabilityErrors');
    await screenshot(client, '10-mobile-profile-pwa.png');

    await click(client, '[data-action="close-profile"]');
    await click(client, '[data-action="open-navigator"]');
    await waitFor(client, '!document.querySelector("#navigator-panel").classList.contains("hidden")');
    await evaluate(client, `(() => {
        const input = document.querySelector('#navigator-destination-input');
        input.value = '55.76500, 37.63500';
        input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await sleep(500);
    await click(client, '[data-action="build-free-route"]');
    await waitFor(client, 'document.body.classList.contains("is-navigation-mode") || !document.querySelector("#navigator-message").classList.contains("hidden")', 30000);
    await sleep(3500);
    report.scenarios.navigationBuild = await evaluate(client, `(() => ({
        navigationMode: document.body.classList.contains('is-navigation-mode'),
        following: document.body.classList.contains('is-navigation-following'),
        message: document.querySelector('#navigator-message')?.textContent?.trim() || '',
        guidanceVisible: Boolean(document.querySelector('.navigation-guidance')),
        speedVisible: Boolean(document.querySelector('.navigation-speed-hud')),
        routePanelVisible: Boolean(document.querySelector('.navigation-panel')),
        instruction: document.querySelector('[data-navigation-instruction]')?.textContent?.trim() || '',
        maneuverDistance: document.querySelector('[data-navigation-maneuver-distance]')?.textContent?.trim() || '',
        speed: document.querySelector('[data-navigation-speed]')?.textContent?.trim() || '',
        speedLimit: document.querySelector('[data-navigation-speed-limit]')?.textContent?.trim() || '',
    }))()`);
    await screenshot(client, '11-mobile-route-built.png');

    if (report.scenarios.navigationBuild.navigationMode) {
        if (!report.scenarios.navigationBuild.following) {
            await click(client, '[data-action="start-navigation"]');
            await sleep(1000);
        }
        const gpsSteps = [
            { latitude: 55.75222, longitude: 37.61556, heading: 55, speed: 8.33 },
            { latitude: 55.75410, longitude: 37.61850, heading: 50, speed: 11.11 },
            { latitude: 55.75620, longitude: 37.62200, heading: 45, speed: 13.89 },
        ];
        report.scenarios.gpsMovement = [];
        for (const [index, step] of gpsSteps.entries()) {
            const startedAt = Date.now();
            await client.send('Emulation.setGeolocationOverride', {
                ...step,
                accuracy: 7,
            });
            await sleep(3000);
            const state = await evaluate(client, `(() => ({
                speed: document.querySelector('[data-navigation-speed]')?.textContent?.trim() || '',
                instruction: document.querySelector('[data-navigation-instruction]')?.textContent?.trim() || '',
                maneuverDistance: document.querySelector('[data-navigation-maneuver-distance]')?.textContent?.trim() || '',
                following: document.body.classList.contains('is-navigation-following'),
                marker: document.querySelector('.maplibregl-marker')?.style.transform || '',
            }))()`);
            report.scenarios.gpsMovement.push({ index, elapsedMs: Date.now() - startedAt, ...step, ...state });
        }
        await screenshot(client, '12-mobile-navigation-moving.png');

        const routeRequestCountBeforeDeviation = report.routeRequests.length;
        const rerouteStartedAt = Date.now();
        await client.send('Emulation.setGeolocationOverride', {
            latitude: 55.77000,
            longitude: 37.59000,
            accuracy: 10,
            heading: 270,
            speed: 13.89,
        });
        const rerouteDeadline = Date.now() + 15000;
        while (Date.now() < rerouteDeadline && report.routeRequests.length === routeRequestCountBeforeDeviation) {
            await sleep(250);
        }
        await sleep(3000);
        report.scenarios.offRoute = await evaluate(client, `(() => ({
            observedForMs: ${Date.now()} - ${rerouteStartedAt},
            navigationMode: document.body.classList.contains('is-navigation-mode'),
            following: document.body.classList.contains('is-navigation-following'),
            instruction: document.querySelector('[data-navigation-instruction]')?.textContent?.trim() || '',
            maneuverDistance: document.querySelector('[data-navigation-maneuver-distance]')?.textContent?.trim() || '',
            speed: document.querySelector('[data-navigation-speed]')?.textContent?.trim() || '',
        }))()`);
        report.scenarios.offRoute.routeRequestTriggered = report.routeRequests.length > routeRequestCountBeforeDeviation;
        await screenshot(client, '13-mobile-navigation-off-route.png');

        const failureStartedAt = Date.now();
        await client.send('Emulation.setGeolocationOverride', {});
        await sleep(6000);
        report.scenarios.gpsUnavailable = await evaluate(client, `(() => ({
            observedForMs: ${Date.now()} - ${failureStartedAt},
            navigationMode: document.body.classList.contains('is-navigation-mode'),
            following: document.body.classList.contains('is-navigation-following'),
            statusText: document.querySelector('#status-panel')?.textContent?.trim() || '',
            speed: document.querySelector('[data-navigation-speed]')?.textContent?.trim() || '',
            instruction: document.querySelector('[data-navigation-instruction]')?.textContent?.trim() || '',
        }))()`);
        await screenshot(client, '14-mobile-navigation-gps-unavailable.png');
    }

    report.finishedAt = new Date().toISOString();
    delete report.scenarios.adminDesktop.data.spots;
    await fs.writeFile(path.join(outputDir, 'live-report.json'), JSON.stringify(report, null, 2));
} finally {
    client.close();
}

console.log(JSON.stringify({
    report: path.join(outputDir, 'live-report.json'),
    screenshots: 14,
}, null, 2));
