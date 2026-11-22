// Exercise the real public WebUI in a fresh browser with dummy data and an in-memory native bridge.
// This test does not use a real account, saved profile, private stream, or streaming provider.
const {chromium} = require('playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const path = require('node:path');
const assets = path.join(__dirname, '../src/stremio_app/ezra_assets/');
const manifest = fs.readFileSync(path.join(__dirname, '../Cargo.toml'), 'utf8');
const shellVersion = manifest.match(/^version\s*=\s*"([^"]+)"/m)[1];
const injected = ['next_episode.js','fork-lists.js','library_adapter.js','episode_artwork.js','artwork.js','playback_shortcuts.js']
    .map(name => fs.readFileSync(path.join(assets, name), 'utf8')).join('\n');

(async () => {
    const browser = await chromium.launch({headless:true,
        executablePath:[process.env.STREMIO_TEST_BROWSER, 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(file=>file && fs.existsSync(file))});
    try {
        const page = await browser.newPage();
        page.setDefaultTimeout(15000);
        const pageErrors = [];
        page.on('pageerror', error => pageErrors.push(error.message));
        await page.route('https://library-art.test/**', route => route.fulfill(route.request().url().includes('broken')
            ? {status:404,body:'missing'} : {contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="100" height="150"><rect width="100" height="150" fill="#7272c2"/></svg>'}));
        const findFixtureIds = `(window.webpackChunkstremio ||= []).push([['fixture-ids'], {}, require => {
            const candidates = Object.entries(require.m);
            window.fixtureLibraryId = candidates.find(([,f]) => f.toString().includes('["library-content"]') &&
                f.toString().includes('.useNotifications') && f.toString().includes('detailsVideosFirst:'))?.[0];
        }]);`;
        await page.addInitScript({content: 'window.fixtureShellVersion=' + JSON.stringify(shellVersion) + ';window.chrome ||= {}; window.chrome.webview = new EventTarget();\n' +
            findFixtureIds + '\n' + injected + '\n' + String.raw`
            window.chrome ||= {};
            const bridge = window.chrome.webview;
            window.qt = {webChannelTransport: {send: value => bridge.postMessage(value)}};
            const deliver = value => {
                const message = {data: JSON.stringify(value)};
                window.qt.webChannelTransport.onmessage?.(message);
                bridge.dispatchEvent(new MessageEvent('message', message));
            };
            let saved = {version:1, revision:0, lists:[{id:'favorites',name:'Favorites',items:['tt101']}]};
            bridge.postMessage = raw => {
                const v = JSON.parse(raw);
                if (v.args?.[0] === 'fork-library-store') {
                    const req = v.args[1];
                    if (req.action === 'save') saved = {...saved, revision:saved.revision+1, lists:req.lists};
                    queueMicrotask(() => deliver({id:1,type:1,object:'transport',
                        args:['fork-library-store-result',{requestId:req.requestId,record:saved}]}));
                }
                if (v.id === 0) queueMicrotask(() => deliver({id:0,type:3,object:'transport',data:{transport:{
                    properties:[[],['','shellVersion','',window.fixtureShellVersion]],signals:[],methods:[['onEvent','']],
                }}}));
            };
            const profile = {auth:{user:{_id:'fixture',email:'local@example.invalid'}},settings:{}};
            const movies = [
                {_id:'tt101',name:'Alpha',type:'movie',posterShape:'poster',watched:true,removed:false,temp:false,
                    poster:'https://library-art.test/broken.svg',background:'https://library-art.test/background.svg',
                    state:{timesWatched:2},deepLinks:{metaDetailsStreams:'stremio:///detail/movie/tt101/tt101'}},
                {_id:'kitsu:2',name:'Anime Two',type:'series',posterShape:'poster',watched:false,removed:false,temp:false,
                    background:'https://library-art.test/background.svg',
                    state:{timesWatched:0},deepLinks:{metaDetailsVideos:'stremio:///detail/series/kitsu%3A2'}},
                {_id:'tt103',name:'Zeta',type:'series',posterShape:'poster',watched:false,removed:false,temp:false,
                    state:{timesWatched:0},deepLinks:{metaDetailsVideos:'stremio:///detail/series/tt103'}},
            ];
            function seed() {
                localStorage.setItem('profile', JSON.stringify(profile));
                localStorage.setItem('stremio-fork-anime-imdb-index-v1', JSON.stringify({fetchedAt:Date.now(),ids:['tt99999999']}));
                localStorage.setItem('library', JSON.stringify({uid:'fixture',
                    items:Object.fromEntries(movies.map(item=>[item._id,item]))}));
            }
            (window.webpackChunkstremio ||= []).push([['fixture-layer'],{}, require => {
                for (const [id,factory] of Object.entries(require.m)) {
                    const source = factory.toString();
                    if (id === window.fixtureLibraryId)
                        require.m[id] = function (mod, exp, load) {
                            factory(mod, exp, new Proxy(load, {apply(target,owner,args) {
                                const lib = Reflect.apply(target,owner,args);
                                return typeof lib?.useProfile === 'function' && typeof lib?.useNotifications === 'function'
                                    ? {...lib, useProfile:()=>{seed();return profile;}, useNotifications:()=>({items:{}})}
                                    : lib;
                            }}));
                        };
                    if (source.includes('model:"LibraryWithFilters"') && source.includes('LoadNextPage'))
                        require.m[id] = mod => {
                            mod.exports = () => {
                                const selected = {type:'all',request:{page:1}};
                                const deepLinks = {library:'stremio:///library'};
                                const types = [{type:null,selected:true,deepLinks},
                                    {type:'movie',selected:false,deepLinks:{library:'stremio:///library/movie'}}];
                                const sorts = [{sort:'lastwatched',selected:true,deepLinks:{library:'stremio:///library?sort=lastwatched'}}];
                                return [{selected,selectable:{types,sorts,nextPage:null},catalog:movies},()=>{}];
                            };
                        };
                }
            }]);
        `});
        await page.goto('https://web.stremio.com/#/library');
        await page.waitForFunction(() => window.__stremioForkCustomListsPatched === true, {}, {timeout:12000});
        const toolbar = page.locator('[data-fork-library-toolbar]');
        await toolbar.waitFor({timeout:15000});
        await page.waitForFunction(() => window.__stremioExpandedArtwork === true);
        await page.waitForFunction(() => [...document.querySelectorAll('img')].filter(image =>
            image.src === 'https://library-art.test/background.svg' && image.complete && image.naturalWidth > 0).length >= 2);
        assert.equal(await page.getByRole('button',{name:'Lists',exact:true}).count(),0);
        await toolbar.getByText('Anime',{exact:true}).click();
        await page.waitForURL('**/*forkList=anime*');
        await page.getByText('Anime Two',{exact:true}).waitFor();
        await page.getByText('Zeta',{exact:true}).waitFor({state:'detached'});
        const listChips = toolbar.locator('[class*="chips-"]').first();
        await listChips.getByText('All',{exact:true}).click();
        await page.waitForURL('**/*forkList=all*');
        const alpha = page.locator('[class*="meta-item-container-"]').filter({hasText:'Alpha'}).last();
        await alpha.hover();
        await alpha.locator('[class*="menu-label-container-"]').click();
        await page.getByText('Move to Anime',{exact:true}).waitFor();
        await page.getByText('Add to list',{exact:true}).click();
        let single = page.getByRole('dialog',{name:'Add to list'});
        await single.getByRole('checkbox',{name:'Favorites',exact:true}).check();
        await single.getByRole('button',{name:'Add',exact:true}).click();
        await single.waitFor({state:'hidden'});
        await toolbar.locator('.fork-library-custom').click();
        await page.getByText('Favorites',{exact:true}).click();
        await page.waitForURL('**/*forkList=favorites*');
        await alpha.hover();
        await alpha.locator('[class*="menu-label-container-"]').click();
        await page.getByText('Remove from this list',{exact:true}).click();
        await page.getByText('This list is empty.',{exact:true}).waitFor();
        await listChips.getByText('All',{exact:true}).click();
        await page.waitForURL('**/*forkList=all*');
        await alpha.hover();
        await alpha.locator('[class*="menu-label-container-"]').click();
        await page.getByText('Move to Anime',{exact:true}).click();
        await listChips.getByText('Anime',{exact:true}).click();
        await page.waitForURL('**/*forkList=anime*');
        await page.getByText('Alpha',{exact:true}).waitFor();
        await page.getByText('Anime Two',{exact:true}).waitFor();
        await toolbar.locator('.fork-library-type').click();
        await page.getByText(/^Movies?$/).click();
        await page.waitForURL(url=>url.hash.startsWith('#/library/movie?'));
        await page.getByText('Alpha',{exact:true}).waitFor();
        await page.getByText('Anime Two',{exact:true}).waitFor({state:'detached'});
        await toolbar.locator('.fork-library-type').click();
        await page.locator('[class*="option-"][class*="button-container-"]').filter({hasText:/^All$/}).click();
        await page.waitForURL(url=>url.hash.startsWith('#/library?'));
        await page.getByText('Anime Two',{exact:true}).waitFor();
        await toolbar.locator('.fork-library-sort').click();
        await page.getByText('Z–A',{exact:true}).click();
        await page.waitForURL('**/*sort=namereverse*');
        await page.waitForFunction(() => {
            const cards = [...document.querySelectorAll('[class*="meta-item-container-"]')];
            return cards[0]?.textContent.includes('Anime Two') && cards[1]?.textContent.includes('Alpha');
        });
        const sortedCards = await page.locator('[class*="meta-item-container-"]').allTextContents();
        assert.ok(sortedCards[0].includes('Anime Two') && sortedCards[1].includes('Alpha'), sortedCards);
        await listChips.getByText('All',{exact:true}).click();
        await page.waitForURL('**/*forkList=all*');
        await alpha.locator('a').first().click({modifiers:['Control']});
        const zeta = page.locator('[class*="meta-item-container-"]').filter({hasText:'Zeta'}).last();
        await zeta.locator('a').first().click({modifiers:['Control']});
        await toolbar.getByRole('button',{name:'Add to list (2)',exact:true}).click({timeout:5000});
        const add = page.getByRole('dialog',{name:'Add to list'});
        await add.getByRole('checkbox',{name:'Favorites',exact:true}).check();
        await add.getByRole('button',{name:'Add',exact:true}).click();
        await add.waitFor({state:'hidden'});
        await toolbar.locator('.fork-library-sort').click();
        await page.getByText('Not Watched',{exact:true}).click();
        await page.waitForURL('**/*sort=notwatched*');
        await page.getByText('Alpha',{exact:true}).waitFor({state:'detached'});
        await toolbar.getByRole('button',{name:'Create list',exact:true}).click();
        const dialog = page.getByRole('dialog',{name:'Create list'});
        await dialog.getByRole('textbox',{name:'List name'}).fill('Weekend');
        await dialog.getByRole('button',{name:'Create',exact:true}).click();
        await page.waitForURL(url => /^[\da-f-]{36}$/i.test(new URLSearchParams(url.hash.split('?')[1]).get('forkList')));
        assert.deepEqual(pageErrors, [], 'The hosted Library must render without uncaught errors');
        console.log('PASS: current hosted UI individual Add to list, category move, list-only removal preserving Library titles, bulk selection, watched filter, and list creation.');
    } catch (error) {
        console.error(error);
        process.exitCode = 1;
    } finally {
        await browser.close();
    }
})();
