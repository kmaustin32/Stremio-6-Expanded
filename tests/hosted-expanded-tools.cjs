// Exercise the public Settings and Player routes without a real account or stream.
const {chromium} = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const {deflateSync} = require('node:zlib');
const assert = require('node:assert/strict');
const script = fs.readFileSync(path.join(__dirname, '../src/stremio_app/ezra_assets/expanded_tools.js'), 'utf8');
const manifest = fs.readFileSync(path.join(__dirname, '../Cargo.toml'), 'utf8');
const version = manifest.match(/^version\s*=\s*"([^"]+)"/m)[1];
const versionLabel = version.replace(/-custom\.(\d+)$/, ' Beta $1');
const origin = 'https://web.stremio.com';

// Unlike Playwright clicks, this check does not scroll the element into view.
function hitTest(element) {
    const {x,y,width,height} = element.getBoundingClientRect();
    return element.contains(document.elementFromPoint(x+width/2,y+height/2));
}

async function waitInView(locator, message) {
    const element = await locator.elementHandle();
    try {
        await locator.page().waitForFunction(hitTest, element, {timeout:5000});
    } catch (error) {
        throw new Error(message, {cause:error});
    } finally {
        await element.dispose();
    }
}

(async () => {
    const browser = await chromium.launch({headless:true, executablePath:[process.env.STREMIO_TEST_BROWSER,
        'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
        'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(file => file && fs.existsSync(file))});
    try {
        const page = await browser.newPage({viewport:{width:1280,height:720}});
        page.setDefaultTimeout(15000);
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.route('https://expanded-fixture.test/**', route => route.fulfill({status:404,body:'synthetic fixture'}));
        await page.addInitScript({content:'window.fixtureExpandedVersion = ' + JSON.stringify(version) + ';\n' + String.raw`
            window.chrome ||= {};
            const bridge = window.chrome.webview = new EventTarget();
            window.qt = {webChannelTransport: {send: raw => bridge.postMessage(raw)}};
            window.updateCalls = [];
            window.playerCalls = [];
            const send = (name, data) => {
                const event = {data:JSON.stringify({id:1,type:1,object:'transport',args:[name,data]})};
                window.qt.webChannelTransport.onmessage?.(event);
                bridge.dispatchEvent(new MessageEvent('message',event));
            };
            let blur = false, shader = 0, crop = 'idle';
            bridge.postMessage = raw => {
                const request = JSON.parse(raw);
                if (request.id === 0) {
                    queueMicrotask(() => window.qt.webChannelTransport.onmessage?.({data:JSON.stringify(
                        {id:0,type:3,object:'transport',data:{transport:{
                            properties:[[],['','shellVersion','',window.fixtureExpandedVersion]],signals:[],methods:[['onEvent','']]
                        }}}
                    )}));
                }
                const [method, arg] = request.args ?? [];
                if (method === 'expanded-updates') {
                    window.updateCalls.push(arg);
                    const value = arg.action === 'info' ? {version:window.fixtureExpandedVersion,portable:false} :
                        arg.action === 'check' ? {available:arg.channel === 'beta' ? '5.0.35-custom.2' : null} :
                        arg.action === 'download' ? {downloaded:true} : {opened:true};
                    queueMicrotask(() => send(method,{requestId:arg.requestId,...value}));
                }
                if (method === 'ezra-playback') {
                    if (arg !== 'status') window.playerCalls.push(arg);
                    if (arg === 'blur') blur = !blur;
                    if (arg === 'detect') crop = crop === 'locked' ? 'idle' : 'locked';
                    if (arg === 'shader-7') shader = 7;
                    if (arg === 'clear') shader = 0;
                    if (arg === 'status') queueMicrotask(() => send('expanded-playback-status',{
                        ready:true,blur,shader,crop,cropMessage:crop === 'locked' ? 'Black bars cropped.' : '',
                        report:{version:window.fixtureExpandedVersion,resolution:'1920 x 1080',codec:'h264',hardwareDecoder:'d3d11va',
                            output:'gpu-next',fps:24,renderDropped:2,decoderDropped:0,buffering:true,bufferPercent:33,
                            bufferSeconds:2.4,videoFilters:false,upscaling:shader ? 'FSR' : 'Off',borderBlur:blur,
                            blackBarCrop:crop === 'locked',streamUrl:'https://example.invalid/private-token'}
                    }));
                }
            };
            Object.defineProperty(navigator,'clipboard',{value:{writeText:async value => {window.copiedReport=value;}}});
        ` + '\n' + script});

        // Reproduce clicking Settings from Home. A direct URL fires a different navigation event.
        await page.goto(origin + '/');
        await page.locator('a[href*="/settings"]').first().click();
        await page.waitForURL(url => url.hash === '#/settings');
        const updates = page.getByRole('region',{name:'Expanded updates'});
        const versionHeading = updates.getByText('Stremio 6 Expanded ' + versionLabel);
        await versionHeading.waitFor({timeout:8000});
        const checkForUpdates = updates.getByRole('button',{name:'Check for updates'});
        await waitInView(checkForUpdates, 'The update button must be on screen when Settings first opens');
        await page.getByText('Help and about',{exact:true}).first().click();
        await page.getByText('About Stremio',{exact:true}).waitFor();
        await waitInView(checkForUpdates, 'The update button must be visible on Help and about');
        await page.goto(origin + '/#/settings/interface');
        await versionHeading.waitFor();
        await waitInView(checkForUpdates, 'The update button must stay in view on the Interface page');
        const channel = updates.getByLabel('Update channel');
        assert.equal(await channel.inputValue(), 'beta', 'New beta installations start on the Beta channel');
        await channel.selectOption('stable');
        await checkForUpdates.click();
        await updates.getByText('You are up to date on this channel.').waitFor();
        await page.reload();
        await versionHeading.waitFor();
        assert.equal(await channel.inputValue(), 'stable');
        await channel.selectOption('beta');
        await checkForUpdates.click();
        await updates.getByText('Available: 5.0.35 Beta 2').waitFor();
        await updates.getByRole('button',{name:'Download update'}).click();
        await updates.getByText('Download verified.',{exact:false}).waitFor();
        assert.ok(!(await page.evaluate(() => window.updateCalls)).some(call => call.action === 'open'));
        await updates.getByRole('button',{name:'Close app and open installer'}).click();
        await page.waitForFunction(() => window.updateCalls.some(call => call.action === 'open'));

        const stream = deflateSync(JSON.stringify({url:'https://expanded-fixture.test/not-a-real-stream.mp4'}))
            .toString('base64');
        await page.goto(origin + '/#/');
        await updates.waitFor({state:'detached'});
        // Emulate an in-app player transition. pushState does not fire hashchange.
        await page.evaluate(stream => {
            const state = {...history.state, idx: (history.state?.idx ?? 0) + 1};
            history.pushState(state, '', '#/player/' + encodeURIComponent(stream));
            dispatchEvent(new PopStateEvent('popstate', {state}));
        }, stream);
        await page.setViewportSize({width:800,height:550});
        await page.mouse.move(530,450);
        const toolsButton = page.getByRole('button',{name:'Playback Tools'});
        await toolsButton.waitFor();
        const seek = page.locator('[class*="control-bar-container-"] [class*="seek-bar-"]').first();
        assert.ok((await toolsButton.boundingBox()).y < (await seek.boundingBox()).y);
        const nativeButtons = page.locator('[class*="control-bar-buttons-container-"]').first();
        await nativeButtons.evaluate(node => { node.style.maxWidth = '20px'; });
        await waitInView(toolsButton, 'The player button must remain usable when the native row clips');
        await toolsButton.click();
        const tools = page.getByRole('dialog',{name:'Playback Tools'});
        await tools.getByRole('button',{name:'Ambient Blur: Off'}).click();
        await tools.getByRole('button',{name:'Ambient Blur: On'}).waitFor();
        await tools.getByRole('button',{name:'Detect Black Bars'}).click();
        await tools.getByRole('button',{name:'Restore Frame'}).waitFor();
        await tools.getByLabel('Upscaling').selectOption('7');
        await tools.getByRole('button',{name:'Copy playback report'}).click();
        await page.waitForFunction(() => window.copiedReport);
        const report = await page.evaluate(() => window.copiedReport);
        assert.match(report, /d3d11va/);
        assert.match(report, /Dropped frames \(renderer \/ decoder\): 2 \/ 0/);
        assert.match(report, /Upscaling: FSR/);
        assert.match(report, /Black-bar crop: Yes/);
        assert.doesNotMatch(report, /example\.invalid|private-token/);
        await tools.getByRole('button',{name:'Restore Frame'}).click();
        await tools.getByRole('button',{name:'Detect Black Bars'}).waitFor();
        await tools.getByLabel('Upscaling').selectOption('0');
        assert.deepEqual(await page.evaluate(() => window.playerCalls), ['blur','detect','shader-7','detect','clear']);
        await tools.getByRole('button',{name:'Done'}).click();
        await tools.waitFor({state:'detached'});
        await page.goBack();
        await toolsButton.waitFor({state:'detached'});
        await page.goForward();
        await page.mouse.move(530,450);
        await toolsButton.waitFor();
        assert.deepEqual(errors, []);
        console.log('PASS: in-app Settings and Player navigation, update check, playback tools, and redacted report');
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
