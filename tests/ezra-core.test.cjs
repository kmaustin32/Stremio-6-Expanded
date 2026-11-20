const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const assets = path.join(__dirname, '../src/stremio_app/ezra_assets');
const {install} = require(path.join(assets, 'library_adapter.js'));
const {decodeLists, classifyLists, moveTitles, previewListImport} = require(path.join(assets, 'fork-lists.js'));

for (const memoized of [false, true]) test(`adapts ${memoized ? 'memoized' : 'plain'} hosted cards and keeps other scopes native`, () => {
    const native = {createElement(type, props, ...children) { return {type, props, children}; }, useEffect() {},
        memo(type, compare) { return {$$typeof:Symbol.for('react.memo'), type, compare}; }};
    const compare = (previous, next) => previous === next;
    const items = {MainNavBars() {}, LibItem() {}};
    const libStyles = {'library-content':'native-content', 'meta-items-container':'native-cards'};
    const profile = {auth:{user:{_id:'local'}}};
    const notifications = {items:{}};
    const hosted = {
        react:native, items, libStyles, memoized, compare,
        hooks:{useProfile:()=>profile, useNotifications:()=>notifications},
        router:{useNavigate:()=>()=>42, useLocation() {}},
    };
    const factories = {
        library(module, _, require) {
            /* ["library-content"] detailsVideosFirst: */
            const react = require('react');
            const {MainNavBars} = require('items');
            require('libStyles');
            const hooks = require('hooks');
            hooks.useProfile();
            hooks.useNotifications();
            module.exports = route => react.createElement(MainNavBars, {route}, 'native body');
        },
        card(module, _, require) {
            /* "LIBRARY_PLAY" detailsVideosFirst */
            const react = require('react');
            const component = _ => react.createElement('card', {options:['native'], optionOnSelect:() => {}});
            component.displayName = 'NativeCard';
            module.exports = require('memoized') ? react.memo(component, require('compare')) : component;
        },
        board(module, _, require) {
            /* ["board-content"] ["board-spotlight"] */
            const react = require('react');
            module.exports = () => react.createElement('div', {className:'board-content-fixture', onScroll:() => {}}, 'Featured Movies');
        },
    };
    const hook = {
        library(react, _, card, notices, css, user, nav, body) {
            assert.equal(react, native);
            assert.equal(card, items.LibItem);
            assert.equal(notices, notifications);
            assert.equal(css, libStyles);
            assert.equal(user, profile);
            assert.equal(nav.route, 'library');
            assert.equal(body, 'native body');
            return 'inline Ezra Library';
        },
        hasListRoute: () => false,
        menu: (options, handler) => [...options, handler()],
        home: (_, __, children) => children + ' then lists',
    };
    assert.equal(install(factories, hook), true);
    function load(key) {
        const module = {exports: {}};
        factories[key](module, module.exports, dependency => hosted[dependency]);
        return module.exports;
    }
    assert.equal(load('library')('library'), 'inline Ezra Library');
    assert.equal(load('library')('continue_watching').children[0], 'native body');
    const card = load('card');
    if (memoized) {
        assert.equal(card.$$typeof, Symbol.for('react.memo'));
        assert.equal(card.compare, compare, 'Keep the hosted memo comparison');
    }
    const render = memoized ? card.type : card;
    assert.equal(render.displayName, 'NativeCard');
    assert.deepEqual(render({optionOnSelect:()=> 'Add to list'}).props.options, ['native', 'Add to list']);
    assert.deepEqual(render({}).props.options, ['native']);
    assert.throws(() => render({optionOnSelect:()=> {throw new Error('menu-failure');}}), /menu-failure/);
    assert.deepEqual(render({}).props.options, ['native'], 'A failed render must not leak a menu handler');
    assert.equal(load('board')(), 'Featured Movies then lists');
    assert.equal(install({}, hook), false);
});

test('retries a timed-out list load, shares the retry, and preserves saved membership', async () => {
    let now = 100000, timerId = 0, recovered = false;
    const timers = new Map(), requests = [], handlers = new Map();
    const record = {version:1, revision:4, lists:[{id:'favorites',name:'Favorites',items:['tt1']}]};
    const profile = JSON.stringify({auth:{user:{_id:'fixture'}}});
    const window = {addEventListener() {}, dispatchEvent() {}};
    window.self = window.top = window;
    window.chrome = {webview:{addEventListener:(name, callback)=>handlers.set(name, callback),
        postMessage(raw) {
            const request = JSON.parse(raw).args[1];
            requests.push(request);
            if (recovered) queueMicrotask(() => handlers.get('message')({data:{args:
                ['fork-library-store-result',{requestId:request.requestId,record}]}}));
        }}};
    const context = {window, location:{origin:'https://web.stremio.com',hash:'#/library'},
        localStorage:{getItem:key => key === 'profile' ? profile : null},
        crypto:require('node:crypto').webcrypto,
        Date:class extends Date {static now() {return now;}},
        setTimeout(callback, delay) {timers.set(++timerId,{callback,delay}); return timerId;},
        clearTimeout:id=>timers.delete(id), Event:class {},
        document:{body:null,head:{append() {}},createElement:()=>({}),addEventListener() {}}};
    vm.runInNewContext(fs.readFileSync(path.join(assets,'fork-lists.js'),'utf8'), context);
    const api = window.__stremioForkLists;
    const initial = assert.rejects(api.exportLists(), /unavailable/);
    await new Promise(setImmediate);
    assert.equal(requests.length, 1);
    now += 5000;
    for (const {callback,delay} of [...timers.values()]) if (delay === 5000) callback();
    await initial;
    recovered = true;
    await assert.rejects(api.exportLists(), /unavailable/);
    assert.equal(requests.length, 1, 'Cooldown must prevent a retry loop');
    now += 5000;
    const [first, second] = await Promise.all([api.exportLists(), api.exportLists()]);
    assert.equal(requests.length, 2, 'Concurrent readers must share one retry');
    assert.deepEqual(JSON.parse(JSON.stringify(first)), JSON.parse(JSON.stringify(second)));
    assert.deepEqual(Array.from(first.lists.find(list=>list.id === 'favorites').items), ['tt1']);
    await api.exportLists();
    assert.equal(requests.length, 2, 'Keep the successfully recovered record cached');
});

test('keeps saved list membership and honors manual Anime/Live Action moves', () => {
    const lists = decodeLists({version:1, lists:[{id:'favorites', name:'Favorites', items:['kitsu:4']}]});
    const titles = new Map([['kitsu:4', {_id:'kitsu:4',type:'series'}], ['tt1',{_id:'tt1',type:'movie'}]]);
    assert.equal(classifyLists(lists, titles, null).categories.get('kitsu:4'), 'anime');
    moveTitles(lists, ['kitsu:4'], 'live-action');
    assert.equal(classifyLists(lists, titles, null).categories.get('kitsu:4'), 'live-action');
    const imported = previewListImport(lists, {version:1, lists:[{id:'favorites', name:'Favorites', items:['tt1']}]});
    assert.deepEqual(imported.lists.find(list => list.id === 'favorites').items, ['kitsu:4','tt1']);
});

test('only the requested playback shortcuts reach the player', () => {
    const sent = [];
    let down;
    const window = {chrome:{webview:{postMessage: value => sent.push(JSON.parse(value).args)}},
        addEventListener: (_, handler) => { down = handler; }};
    window.top = window;
    const location = {origin:'https://web.stremio.com', hash:'#/player/a'};
    vm.runInNewContext(fs.readFileSync(path.join(assets, 'playback_shortcuts.js'), 'utf8'), {window,location});
    const key = (code, more = {}) => down({code, ctrlKey:true, target:{},
        preventDefault() {}, stopImmediatePropagation() {}, ...more});
    key('KeyB');
    key('KeyC',{shiftKey:true});
    for(let i=1;i<=8;i++) key('Digit'+i);
    key('KeyF',{shiftKey:true});
    key('Digit7',{repeat:true});
    key('KeyB',{target:{closest:()=>true}});
    location.hash='#/library';
    key('KeyB');
    assert.deepEqual(sent, ['blur','detect','shader-1','shader-2','shader-3','shader-4',
        'shader-5','shader-6','shader-7','clear'].map(action => ['ezra-playback',action]));
});
