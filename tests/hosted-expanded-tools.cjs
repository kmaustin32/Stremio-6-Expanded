// Exercise the public Settings and Player routes without a real account or stream.
const {chromium} = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const {deflateSync} = require('node:zlib');
const assert = require('node:assert/strict');
const assets = path.join(__dirname, '../src/stremio_app/ezra_assets');
const script = (() => {
    const executable = process.argv[2];
    if (!executable) return fs.readFileSync(path.join(assets, 'expanded_tools.js'), 'utf8');
    const names = ['next_episode.js', 'fork-lists.js', 'library_adapter.js', 'episode_artwork.js',
        'artwork.js', 'playback_shortcuts.js', 'expanded_tools.js'];
    const expected = Buffer.from(names.map(name => fs.readFileSync(path.join(assets, name), 'utf8')).join('\n'));
    const binary = fs.readFileSync(executable);
    const offset = binary.indexOf(expected);
    assert.ok(offset >= 0, 'The installed executable must contain the complete WebView2 script in its original order');
    console.log('Testing the combined UI script read from the installed executable.');
    return binary.subarray(offset, offset + expected.length).toString('utf8');
})();
const manifest = fs.readFileSync(path.join(__dirname, '../Cargo.toml'), 'utf8');
const version = manifest.match(/^version\s*=\s*"([^"]+)"/m)[1];
const versionLabel = version.replace(/-custom\.(\d+)$/, ' Beta $1');
const [major, minor, patch] = version.split('-')[0].split('.').map(Number);
const betaUpdate = `${major}.${minor}.${patch + 1}-custom.2`;
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
        await page.addInitScript({content:
            'window.fixtureExpandedVersion = ' + JSON.stringify(version) + ';\n' +
            'window.fixtureBetaUpdate = ' + JSON.stringify(betaUpdate) + ';\n' + String.raw`
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
                        arg.action === 'check' ? {available:arg.channel === 'beta' ? window.fixtureBetaUpdate : null} :
                        arg.action === 'download' ? {downloaded:true} : {opened:true};
                    queueMicrotask(() => send(method,{requestId:arg.requestId,...value}));
                }
                if (method === 'ezra-playback') {
                    if (arg !== 'status') window.playerCalls.push(arg);
                    if (arg === 'blur') blur = !blur;
                    if (arg === 'detect') {
                        if (crop === 'locked') crop = 'idle';
                        else {
                            crop = 'detecting';
                            setTimeout(() => { crop = 'locked'; }, 950);
                        }
                    }
                    if (/^shader-[1-7]$/.test(arg)) shader = Number(arg.at(-1));
                    if (arg === 'clear') shader = 0;
                    if (arg === 'status') queueMicrotask(() => send('expanded-playback-status',{
                        ready:true,blur,shader,crop,cropMessage:crop === 'locked' ?
                            'Black bars cropped. Ctrl+Shift+C restores the full frame.' :
                            crop === 'detecting' ? 'Detecting black bars. Keep the video playing.' : '',
                        report:{version:window.fixtureExpandedVersion,resolution:'1920 x 1080',codec:'h264',hardwareDecoder:'d3d11va',
                            output:'gpu-next',fps:24,renderDropped:2,decoderDropped:0,buffering:true,bufferPercent:33,
                            bufferSeconds:2.4,videoFilters:false,upscaling:shader ? 'FSR' : 'Off',borderBlur:blur,
                            blackBarCrop:crop === 'locked',streamUrl:'https://example.invalid/private-token'}
                    }));
                }
            };
            Object.defineProperty(navigator,'clipboard',{value:{writeText:async value => {
                if (window.fixtureDenyClipboard) throw new Error('Clipboard denied by fixture');
                window.copiedReport=value;
            }}});
        ` + '\n' + script});

        // Reproduce clicking Settings from Home. A direct URL fires a different navigation event.
        await page.goto(origin + '/');
        await page.locator('a[href*="/settings"]').first().click();
        await page.waitForURL(url => url.hash === '#/settings');
        const updates = page.getByRole('region',{name:'Expanded updates'});
        const versionHeading = updates.getByText('Stremio 6 Expanded ' + versionLabel);
        await page.getByText('Help and about',{exact:true}).first().waitFor();
        assert.equal(await updates.count(), 0, 'The update card belongs only on Help and about');
        const checkForUpdates = updates.getByRole('button',{name:'Check for updates'});
        await page.getByText('Help and about',{exact:true}).first().click();
        await page.getByText('About Stremio',{exact:true}).waitFor();
        await versionHeading.waitFor();
        await waitInView(checkForUpdates, 'The update button must be visible on Help and about');
        await page.goto(origin + '/#/settings/interface');
        await updates.waitFor({state:'detached'});
        assert.equal(await updates.count(), 0);
        await page.getByText('Help and about',{exact:true}).first().click();
        await versionHeading.waitFor();
        await waitInView(checkForUpdates, 'The card must reappear after returning to Help and about');
        const channel = updates.getByLabel('Update channel');
        const defaultChannel = version.includes('-custom.') ? 'beta' : 'stable';
        assert.equal(await channel.inputValue(), defaultChannel, 'The default channel matches the installed release type');
        await channel.selectOption('stable');
        await checkForUpdates.click();
        await updates.getByText('You are up to date on this channel.').waitFor();
        await channel.selectOption('beta');
        await page.reload();
        await versionHeading.waitFor();
        assert.equal(await channel.inputValue(), 'beta');
        await checkForUpdates.click();
        await updates.getByText('Available: ' + betaUpdate.replace('-custom.', ' Beta ')).waitFor();
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
        const applyPalette = (accent, surface, foreground) => page.evaluate(({accent,surface,foreground}) => {
            const player = document.querySelector('[class*="player-container-"]');
            player.style.setProperty('--accent-color', '#7b5bf5');
            player.style.setProperty('--accent-background-color', accent);
            player.style.setProperty('--modal-background-color', surface);
            player.style.setProperty('--foreground-color-primary', foreground);
        }, {accent,surface,foreground});
        const seekTrack = seek.locator('[class^="track-"]:not([class^="track-before-"]):not([class^="track-after-"])').first();
        const seekAccent = () => seekTrack.evaluate(track => getComputedStyle(track).backgroundColor);
        await applyPalette('#d6492d', '#221411', '#f5ede8');
        assert.equal(await seekAccent(), 'rgb(214, 73, 45)', 'The native seek bar uses the selected theme');
        await toolsButton.hover();
        assert.equal(await toolsButton.evaluate(button => getComputedStyle(button).borderColor), await seekAccent(),
            'The hovered Playback Tools button must match the seek bar, even if the brand token is still purple');
        await toolsButton.click();
        const tools = page.getByRole('dialog',{name:'Playback Tools'});
        await tools.getByRole('button',{name:'Ambient Blur: Off'}).waitFor();
        async function geometry() {
            return tools.evaluate(dialog => [dialog,
                ...dialog.querySelectorAll('button, select')].map(element => {
                const {x,y,width,height} = element.getBoundingClientRect();
                return [x,y,width,height];
            }));
        }
        const initial = await geometry();
        await tools.getByRole('button',{name:'Ambient Blur: Off'}).click();
        await tools.getByRole('button',{name:'Ambient Blur: On'}).waitFor();
        assert.deepEqual(await geometry(), initial, 'The blur toggle must not move the rows');
        await tools.getByRole('button',{name:'Detect Black Bars'}).click();
        await tools.getByRole('button',{name:'Detecting Black Bars...'}).waitFor();
        assert.deepEqual(await geometry(), initial, 'Detection must leave the rows and footer in place');
        await tools.getByRole('button',{name:'Restore Frame'}).waitFor();
        assert.deepEqual(await geometry(), initial, 'A crop message must not resize the dialog');
        const upscaling = tools.getByLabel('Upscaling');
        await upscaling.selectOption('7');
        await tools.getByRole('button',{name:'Copy playback report'}).click();
        await page.waitForFunction(() => window.copiedReport);
        const report = await page.evaluate(() => window.copiedReport);
        assert.match(report, /d3d11va/);
        assert.match(report, /Dropped frames \(renderer \/ decoder\): 2 \/ 0/);
        assert.match(report, /Upscaling: FSR/);
        assert.match(report, /Black-bar crop: Yes/);
        assert.doesNotMatch(report, /example\.invalid|private-token/);
        assert.deepEqual(await geometry(), initial, 'Copy feedback must not move the rows');
        await tools.getByRole('button',{name:'Restore Frame'}).click();
        await tools.getByRole('button',{name:'Detect Black Bars'}).waitFor();
        assert.deepEqual(await geometry(), initial, 'Restoring the frame must not move the rows');

        const readTheme = () => tools.evaluate(dialog => {
            const button = document.querySelector('.expanded-playback-button');
            const pixel = color => {
                const context = document.createElement('canvas').getContext('2d');
                context.fillStyle = color;
                context.fillRect(0,0,1,1);
                return [...context.getImageData(0,0,1,1).data];
            };
            return [pixel(getComputedStyle(button).backgroundColor), pixel(getComputedStyle(dialog).backgroundColor),
                pixel(getComputedStyle(dialog).color), pixel(getComputedStyle(dialog.querySelector('[aria-pressed="true"]')).borderColor),
                pixel(getComputedStyle(button).color), pixel(getComputedStyle(dialog.querySelector('.expanded-playback-done')).backgroundColor)];
        });
        const darkTheme = await readTheme();
        assert.ok(darkTheme[0][3] < 255 && darkTheme[1][3] < 255, 'Both surfaces are slightly translucent');
        assert.deepEqual(darkTheme[3], [214,73,45,255], 'The selected blur toggle uses the warm theme accent');
        assert.deepEqual(darkTheme[5], darkTheme[3], 'Done uses the same warm accent');
        await applyPalette('#28765b', '#f4eddf', '#231b17');
        const lightTheme = await readTheme();
        assert.ok(lightTheme[0][0] > 210 && lightTheme[1][0] > 210, 'Both surfaces adopt the new theme while open');
        assert.deepEqual(lightTheme[2], [35,27,23,255]);
        assert.deepEqual(lightTheme[3], [40,118,91,255]);
        assert.deepEqual(lightTheme[4], lightTheme[2], 'Both the button and popup use the selected foreground');
        assert.deepEqual(lightTheme[5], lightTheme[3], 'Done uses the same selected accent as the controls');
        const detect = tools.getByRole('button',{name:'Detect Black Bars'});
        await detect.hover();
        assert.equal(await detect.evaluate(button => getComputedStyle(button).borderColor), await seekAccent());
        await detect.focus();
        await page.keyboard.press('Tab');
        assert.ok(await upscaling.evaluate(select => select.matches(':focus-visible')));
        assert.equal(await upscaling.evaluate(select => getComputedStyle(select).outlineColor), await seekAccent());

        await page.setViewportSize({width:390,height:590});
        await page.evaluate(() => { document.documentElement.style.zoom = '1.25'; });
        await tools.getByRole('button',{name:'Done'}).scrollIntoViewIfNeeded();
        const narrow = await geometry();
        await upscaling.selectOption('4');
        assert.deepEqual(await geometry(), narrow, 'A longer preset must keep the same layout on a small, zoomed window');
        assert.ok(await upscaling.evaluate(select => {
            const dialog = select.closest('dialog');
            const style = getComputedStyle(select);
            const context = document.createElement('canvas').getContext('2d');
            context.font = [style.fontStyle, style.fontWeight, style.fontSize, style.fontFamily].join(' ');
            const space = select.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
            return dialog.scrollWidth <= dialog.clientWidth + 1 &&
                context.measureText(select.selectedOptions[0].text).width <= space;
        }), 'The full preset name must fit without horizontal scrolling');

        await page.evaluate(() => { window.fixtureDenyClipboard = true; });
        await tools.getByRole('button',{name:'Copy playback report'}).click();
        await tools.getByRole('textbox',{name:'Playback report text'}).waitFor();
        assert.ok(await tools.getByRole('textbox',{name:'Playback report text'}).inputValue());
        await upscaling.selectOption('0');
        assert.deepEqual(await page.evaluate(() => window.playerCalls), ['blur','detect','shader-7','detect','shader-4','clear']);
        await tools.getByRole('button',{name:'Done'}).click();
        await tools.waitFor({state:'detached'});
        await page.setViewportSize({width:800,height:550});
        await page.evaluate(() => { document.documentElement.style.zoom = ''; });
        await page.goBack();
        await toolsButton.waitFor({state:'detached'});
        await page.goForward();
        await page.mouse.move(530,450);
        await toolsButton.waitFor();
        await toolsButton.click();
        await tools.waitFor();
        await tools.evaluate(dialog => dialog.remove());
        await toolsButton.click();
        await tools.waitFor({timeout:3_000});
        await page.goBack();
        await tools.waitFor({state:'detached'});
        assert.deepEqual(errors, []);
        console.log('PASS: Help and about updater, playback navigation, live palette changes, stable zoomed layout, and report copy');
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
