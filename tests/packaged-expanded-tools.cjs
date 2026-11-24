// Verify the packaged program's real WebView2 and mpv bridges in a disposable CI profile.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const {deflateSync} = require('node:zlib');
const {setTimeout: delay} = require('node:timers/promises');
const {chromium} = require('playwright');

(async () => {
    const [port, directory, version] = process.argv.slice(2);
    const endpoint = 'http://127.0.0.1:' + port;
    const clip = path.join(process.env.RUNNER_TEMP, 'expanded-tools-smoke.mp4');
    execFileSync(path.join(directory, 'ffmpeg.exe'), [
        '-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=24',
        '-t', '20', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-movflags', '+faststart', clip,
    ], {windowsHide:true, timeout:20000});
    const media = fs.readFileSync(clip);
    const server = http.createServer((req, res) => {
        if (req.url !== '/video.mp4') { res.writeHead(404).end(); return; }
        const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? '');
        const start = range ? Number(range[1]) : 0;
        const end = range?.[2] ? Math.min(Number(range[2]), media.length - 1) : media.length - 1;
        if (start > end) { res.writeHead(416, {'Content-Range':'bytes */' + media.length}).end(); return; }
        const headers = {'Content-Type':'video/mp4', 'Content-Length':end-start+1, 'Accept-Ranges':'bytes'};
        if (range) headers['Content-Range'] = `bytes ${start}-${end}/${media.length}`;
        res.writeHead(range ? 206 : 200, headers).end(req.method === 'HEAD' ? undefined : media.subarray(start,end+1));
    });
    let browser;
    try {
        await new Promise((resolve, reject) => {
            server.once('error', reject);
            server.listen(0, '127.0.0.1', resolve);
        });
        const deadline = Date.now() + 25000;
        while (Date.now() < deadline) {
            if (await fetch(endpoint + '/json/version', {signal:AbortSignal.timeout(1000)})
                .then(response => response.ok).catch(() => false)) break;
            await delay(300);
        }
        browser = await chromium.connectOverCDP(endpoint, {timeout:5000});
        const context = browser.contexts()[0];
        const page = context.pages()[0] ?? await context.waitForEvent('page', {timeout:15000});
        page.setDefaultTimeout(20000);
        await page.waitForURL(url => url.origin === 'https://web.stremio.com');
        await page.locator('a[href*="/settings"]').first().click();
        await page.getByText('Help and about',{exact:true}).first().click();
        const versionLabel = version.replace(/-custom\.(\d+)$/, ' Beta $1');
        const updates = page.getByRole('region', {name:'Expanded updates'});
        await updates.getByText('Stremio 6 Expanded ' + versionLabel).waitFor();
        const check = updates.getByRole('button',{name:'Check for updates'});
        await check.click();
        const result = updates.getByRole('status').filter({hasText:/up to date|Available:|Could not check GitHub/});
        await result.waitFor({timeout:30000});
        await page.goto('https://web.stremio.com/#/');
        await updates.waitFor({state:'detached'});

        const stream = deflateSync(JSON.stringify({url:`http://127.0.0.1:${server.address().port}/video.mp4`}))
            .toString('base64');
        await page.evaluate(stream => {
            const state = {...history.state, idx: (history.state?.idx ?? 0) + 1};
            history.pushState(state, '', '#/player/' + encodeURIComponent(stream));
            dispatchEvent(new PopStateEvent('popstate', {state}));
        }, stream);
        const toolsButton = page.getByRole('button',{name:'Playback Tools'});
        await toolsButton.waitFor({state:'attached'});
        const bounds = await toolsButton.boundingBox();
        assert.ok(bounds, 'Player tools should be in the packaged player');
        await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
        await toolsButton.click();
        const tools = page.getByRole('dialog',{name:'Playback Tools'});
        await tools.getByRole('button',{name:/Ambient Blur: (On|Off)/}).waitFor();
        const copy = tools.getByRole('button',{name:'Copy playback report'});
        assert.ok(await copy.isEnabled(), 'The real mpv bridge should report that the clip is playing');
        console.log('PASS: packaged app opens Help and about, checks for updates and reports playback tools with a local video.');
    } finally {
        await browser?.close().catch(() => {});
        server.closeAllConnections();
        server.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
