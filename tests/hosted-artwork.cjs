// Render the current public Stremio components using synthetic artwork and a dummy profile.
const {chromium} = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const artwork = ['episode_artwork.js','artwork.js'].map(name =>
    fs.readFileSync(path.join(__dirname, '../src/stremio_app/ezra_assets',name),'utf8')).join('\n');

(async () => {
    const browser = await chromium.launch({headless:true, executablePath:[process.env.STREMIO_TEST_BROWSER,
        'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
        'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(file => file && fs.existsSync(file))});
    try {
        const page = await browser.newPage({viewport:{width:1440,height:1000}});
        page.setDefaultTimeout(10000);
        const errors = [], requests = [];
        let metadataRequests = 0;
        page.on('pageerror', error => errors.push(error.message));
        await page.route('**/scripts/main.js', async route => {
            const response = await route.fetch();
            const source = await response.text();
            const entry = /\w+\.createRoot\(document\.getElementById\("app"\)\)\.render/g;
            assert.equal([...source.matchAll(entry)].length,1,'Recognize the public app entry point');
            await route.fulfill({response,body:source.replace(entry,'window.artworkReady=true;return;$&')});
        });
        await page.route('https://artwork.test/**', route => {
            const url = route.request().url();
            requests.push(url);
            return route.fulfill(url.includes('/broken') ? {status:404,body:'missing'} : {
                contentType:'image/svg+xml', body:'<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#7272c2"/><circle cx="160" cy="90" r="50" fill="#dea066"/></svg>'});
        });
        const seasonEntries = [1,2].flatMap(season=>Array.from({length:27},(_,i)=>({season,episode:i+1})));
        await page.route('https://v3-cinemeta.strem.io/meta/series/tt0290223.json',route=>{
            metadataRequests++;
            return route.fulfill({json:{meta:{id:'tt0290223',videos:[...seasonEntries,
                ...[1,2].map(episode=>({id:`tt0290223:3:${episode}`,season:3,episode,
                    thumbnail:`https://episodes.metahub.space/tt0290223/3/${episode}/w780.jpg`}))]}}});
        });
        await page.route('https://episodes.metahub.space/tt0290223/**',route=>{
            const url=route.request().url();
            requests.push(url);
            const number=/\/1\/(55|56)\/w780.jpg$/.exec(url)?.[1] ||
                (url.endsWith('/3/3/w780.jpg') ? '3' : null);
            return route.fulfill(number ? {contentType:'image/svg+xml',body:`<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="${number==='55'?'#dea066':'#61d1c7'}"/><text x="100" y="100">Episode ${number}</text></svg>`} : {status:404,body:'missing'});
        });
        await page.addInitScript({content:String.raw`
            (window.webpackChunkstremio ||= []).push([['artwork-fixture'],{},require => {
                window.artworkRequire = require;
                const factories = Object.entries(require.m);
                window.artworkSources = Object.fromEntries(factories.map(([id,f]) => [id,f.toString()]));
                window.artworkProfile = {settings:{hideSpoilers:true,interfaceLanguage:'en-US'}};
            }]);
        ` + '\n' + artwork + '\n' + String.raw`
            window.webpackChunkstremio.push([['artwork-fixture-mocks'],{},require => {
                for (const [id,factory] of Object.entries(require.m)) {
                    const source = window.artworkSources[id] || '';
                    if (source.includes('streamingServerWarningDismissed') && source.includes('model:"ctx"')) {
                        require.m[id] = module => {module.exports = () => window.artworkProfile;};
                    } else require.m[id] = function(module,exports,load) {
                        const scoped = new Proxy(load,{apply(target,owner,args) {
                            const loaded = Reflect.apply(target,owner,args);
                            if (!loaded || typeof loaded !== 'object') return loaded;
                            const extra = {};
                            if (loaded.useNavigate) extra.useNavigate = () => () => {};
                            if (loaded.useNavigateWithOrigin) extra.useNavigateWithOrigin = () => ({navigateWithOrigin() {}});
                            if (loaded.useCore) extra.useCore = () => ({transport:{dispatch() {}}});
                            if (loaded.useProfile) extra.useProfile = () => window.artworkProfile;
                            return Object.keys(extra).length ? {...loaded,...extra} : loaded;
                        }});
                        factory.call(this,module,exports,scoped);
                    };
                }
            }]);
        `});
        await page.goto('https://web.stremio.com/');
        await page.waitForFunction(() => window.__stremioExpandedArtwork === true);
        await page.waitForFunction(() => window.artworkReady);
        await page.evaluate(() => {
            const require = window.artworkRequire;
            const sources = Object.entries(window.artworkSources);
            const find = predicate => {
                const matches = sources.filter(([,source]) => predicate(source));
                if (matches.length !== 1) throw Error('Hosted artwork contract changed: ' + matches.map(([id])=>id));
                return require(matches[0][0]);
            };
            const React = find(source => source.includes('react.element') && source.includes('react.forward_ref') && source.includes('createContext'));
            const ReactDOM = find(source => source.includes('createRoot') && source.includes('react-dom'));
            const MetaItem = find(source => source.includes('displayName="MetaItem"'));
            const Video = find(source => source.includes('shouldScroll') && source.includes('seasonWatched') && source.includes('renderLabel:'));
            if (!Video.Placeholder) throw Error('Keep native Video.Placeholder when wrapping artwork');
            const Episodes = find(source => source.includes('metaItem') && source.includes('onSeasonSelect') && source.includes('SEARCH_NO_RESULTS')).default;
            const Next = find(source => source.includes('PLAYER_NEXT_VIDEO_BUTTON_WATCH') && source.includes('fallbackSrc:'));
            const Home = find(source => source.includes('artwork-container') && source.includes('hideSpoilers') && source.includes('metaDetailsStreams')).default;
            const Drawer = find(source => source.includes('seriesInfo') && source.includes('closeSideDrawer') && source.includes('c.Video')).default;
            const Still = find(source => source.includes('.still') && source.includes('renderFallback:') && source.includes('thumbnail')).default;
            const el = React.createElement;
            const root = document.createElement('div');
            root.id = 'artwork-fixture-root';
            root.style.cssText = 'position:fixed;inset:0;overflow:auto;background:#161a26;z-index:99999;padding:20px;';
            document.body.append(root);
            const wrap = (name, child) => el('section', {'data-artwork-scope':name,style:{position:'relative',width:600,minHeight:190}},child);
            function Fixture() {
                const scrollMemoryRef = React.useRef(new Map());
                const [state, set] = React.useState({id:1, thumbnail:'broken-primary',alt:'alternate',poster:'poster',background:'background',watched:false});
                window.changeArtwork = changes => set(previous => ({...previous,...changes}));
                const url = name => name ? 'https://artwork.test/' + name + '/' + state.id + '.svg' : undefined;
                const video = {id:state.anime ? `tt0290223:3:${state.id}` : 'fixture:'+state.id,title:'Episode '+state.id,season:3,episode:state.id,
                    thumbnail:state.anime ? (state.noThumbnail ? undefined : `https://episodes.metahub.space/tt0290223/3/${state.id}/w780.jpg`) : url(state.thumbnail),
                    altThumbnail:url(state.alt),watched:state.watched,progress:0,
                    deepLinks:{metaDetailsStreams:'stremio:///detail/series/fixture',player:null}};
                const next = {...video,id:'tt0290223:3:2',title:'Episode 2',episode:2,
                    thumbnail:'https://episodes.metahub.space/tt0290223/3/2/w780.jpg'};
                const show = {id:state.anime ? 'tt0290223' : 'fixture',name:'Show',type:'series',poster:url(state.poster),background:url(state.background),
                    links:[],videos:state.extraEpisode ? [video,next] : [video]};
                // Obtain the real parent provider by rendering the actual player drawer below.
                return el(React.Fragment,null,
                    wrap('home',el(Home,{...video,name:show.name,poster:show.poster,background:show.background,hideSpoilers:!state.watched})),
                    wrap('library',el(MetaItem,{...show,_id:'fixture',poster:show.poster,altPoster:url(state.alt)})),
                    wrap('details',el(Episodes,{metaItem:show,libraryItem:null,season:3,hideSpoilers:true,error:false,hidden:false,
                        scrollMemoryRef,openEpisode() {},onSeasonSelect() {},onToggleNotifications() {},onMarkVideoWatched() {},onMarkSeasonWatched() {},onEpisodeSearch() {}})),
                    wrap('player',el(Drawer,{metaItem:show,seriesInfo:{season:3},selected:video.id,closeSideDrawer() {}})),
                    wrap('next',el(Next,{metaItem:show,nextVideo:video,onDismiss() {},onNextVideoRequested() {}})),
                    wrap('still',el(Still,{metaItem:show,video,thumbnail:video.thumbnail,blurred:!state.watched})));
            }
            ReactDOM.createRoot(root).render(el(Fixture));
        });
        const scopes = ['home','library','details','player','next','still'];
        async function check(changes, expected, watched = false, libraryExpected = 'poster') {
            await page.evaluate(changes => window.changeArtwork(changes), changes);
            for (const scope of scopes) {
                const wanted = scope === 'library' ? libraryExpected : expected;
                await page.locator(`[data-artwork-scope="${scope}"]`).scrollIntoViewIfNeeded().catch(error=>{console.error(errors);throw error;});
                await page.waitForFunction(({scope,wanted}) => {
                    const images = [...document.querySelectorAll(`[data-artwork-scope="${scope}"] img`)];
                    // Exercise image failures even when a native accordion keeps its contents offscreen.
                    for (const image of images) image.loading = 'eager';
                    return images.some(img => img.complete && img.naturalWidth > 0 && img.src.includes('/'+wanted+'/'));
                }, {scope,wanted}).catch(async error => {
                    console.error({scope,wanted,errors,images:await page.locator('[data-artwork-scope] img').evaluateAll(images=>images.map(img=>({scope:img.closest('section').dataset.artworkScope,src:img.src}))),
                        state:await page.locator('[data-artwork-scope] img').evaluateAll(images=>images.map(img=>({complete:img.complete,width:img.naturalWidth,top:img.getBoundingClientRect().top}))),requests});
                    throw error;
                });
                if (scope === 'library') continue;
                const filter = await page.locator(`[data-artwork-scope="${scope}"] img`).first().evaluate(img=>getComputedStyle(img).filter);
                assert.equal(filter.includes('blur('), !watched, `${scope} blur: ${filter}`);
            }
        }
        // Primary fails: alternate before show art; no URL: use the same fallback chain.
        await check({},'alternate');
        await check({id:2,thumbnail:undefined},'alternate');
        // For Library the primary is the show poster; force its failure for this check.
        await page.evaluate(() => window.changeArtwork({id:3,thumbnail:'broken-primary',alt:'alternate',poster:'broken-poster'}));
        await check({},'alternate',false,'alternate');
        await check({id:4,alt:'broken-alternate',poster:'poster'},'poster');
        await check({id:5,poster:'broken-poster'},'background',false,'background');
        await check({id:6,thumbnail:'primary',alt:'alternate',poster:'poster'},'primary');
        await check({watched:true},'primary',true);
        await check({watched:false},'primary');
        assert.equal(requests.some(url=>url.includes('/alternate/6.svg')),false,'A working primary image must not download alternatives');
        await page.evaluate(() => window.changeArtwork({id:7,thumbnail:'broken-primary',alt:'broken-alternate',poster:'broken-poster',background:'broken-background'}));
        for (const scope of scopes) await page.waitForFunction(scope => {
            const root = document.querySelector(`[data-artwork-scope="${scope}"]`);
            for (const image of root?.querySelectorAll('img') || []) image.loading = 'eager';
            return root && root.querySelectorAll('img').length === 0;
        },scope);
        await page.evaluate(() => window.changeArtwork({id:8,thumbnail:undefined,alt:undefined,poster:undefined,background:undefined}));
        for (const scope of scopes) {
            await page.waitForFunction(scope => document.querySelector(`[data-artwork-scope="${scope}"]`)?.querySelectorAll('img').length === 0,scope);
            assert.ok(await page.locator(`[data-artwork-scope="${scope}"] [class*="placeholder"], [data-artwork-scope="${scope}"] [class*="thumbnail-empty"]`).count(),`${scope}: a placeholder is retained`);
        }
        const exhausted = requests.length;
        await check({id:9,thumbnail:'primary',alt:'alternate',poster:'poster',background:'background'},'primary');
        assert.ok(requests.length > exhausted, 'New episode must recover after all prior images were absent');
        assert.equal(metadataRequests,0,'Working/non-episodic images must not start metadata lookups');
        async function episodeCheck(number,noThumbnail=false,expected=`/1/${54+number}/w780.jpg`) {
            await page.evaluate(({number,noThumbnail})=>window.changeArtwork({id:number,anime:true,alt:undefined,noThumbnail}),{number,noThumbnail});
            for(const scope of scopes.filter(scope=>scope!=='library')) {
                await page.waitForFunction(({scope,expected})=>{
                    const images=[...document.querySelectorAll(`[data-artwork-scope="${scope}"] img`)];
                    for(const img of images)img.loading='eager';
                    return images.some(img=>img.complete&&img.naturalWidth>0&&img.src.endsWith(expected));
                },{scope,expected});
                assert.ok(await page.locator(`[data-artwork-scope="${scope}"] img`).first().evaluate(img=>getComputedStyle(img).filter.includes('blur(')),`${scope}: episode fallback remains blurred`);
            }
        }
        await episodeCheck(3,false,'/3/3/w780.jpg');
        assert.equal(metadataRequests,0,'A working episode image does not fetch an extra catalog');
        await episodeCheck(2);
        await episodeCheck(1);
        await episodeCheck(1,true);
        assert.equal(metadataRequests,1,'Episode views share one cached public catalog');
        await page.evaluate(()=>window.changeArtwork({id:1,noThumbnail:false,extraEpisode:true}));
        for(const scope of ['details','player']) await page.waitForFunction(scope=>{
            const images=[...document.querySelectorAll(`[data-artwork-scope="${scope}"] img`)];
            for(const img of images)img.loading='eager';
            const loaded=images.filter(img=>img.complete&&img.naturalWidth>0).map(img=>img.src);
            return loaded.some(src=>src.endsWith('/1/55/w780.jpg'))&&loaded.some(src=>src.endsWith('/1/56/w780.jpg'))&&loaded.length===2;
        },scope);
        assert.deepEqual(errors,[]);
        const output = process.env.STREMIO_UI_TEST_OUTPUT;
        if (output) { fs.mkdirSync(output,{recursive:true}); await page.screenshot({path:path.join(output,'artwork-fallback.png')}); }
        console.log('PASS: real hosted artwork views; missing/broken URLs, episode-specific anime numbering, distinct adjacent episode images, shared metadata lookup, no-URL recovery, blur and watched state.');
    } finally { await browser.close(); }
})().catch(error => {console.error(error);process.exitCode=1;});
