const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assets = path.join(__dirname, '../src/stremio_app/ezra_assets');
const model = require(path.join(assets, 'library_model.js'));

test('backup import preserves manual categories and merges custom list members', () => {
    const existing = model.decodeLists({version: 1, lists: [
        {id: 'anime', name: 'Anime', items: ['tt1']},
        {id: 'favorites', name: 'Favorites', items: ['tt2']},
    ]});
    const previous = {version: 1, lists: [
        {id: 'live-action', name: 'Live Action', items: ['tt1', 'tt3']},
        {id: 'favorite-older', name: 'Favorites', items: ['tt2', 'tt4']},
    ]};
    const bytes = new TextEncoder().encode(JSON.stringify({
        format: 'ezras-stremio-backup', version: 1, customLists: previous,
    })).buffer;
    const merged = model.previewListImport(existing, model.readListBackup(bytes)).lists;
    assert.deepEqual(merged.find(list => list.id === 'anime').items, ['tt1']);
    assert.deepEqual(merged.find(list => list.id === 'live-action').items, ['tt3']);
    assert.deepEqual(merged.find(list => list.id === 'favorites').items, ['tt2', 'tt4']);
    assert.deepEqual(existing.find(list => list.id === 'favorites').items, ['tt2']);
});

test('confirmed Anime IDs classify titles and explicit category moves win', () => {
    const ids = model.imdbIds({'[tt1]': {'anime-list': [42]}});
    const lists = model.decodeLists(null);
    const data = new Map([
        ['tt1', {_id:'tt1', type:'series'}],
        ['kitsu:2', {_id:'kitsu:2', type:'series'}],
        ['tt3', {_id:'tt3', type:'movie'}],
    ]);
    assert.deepEqual(model.classifyLists(lists, data, ids).lists.map(list => list.items), [['tt1', 'kitsu:2'], ['tt3']]);
    model.moveTitles(lists, ['tt1'], 'live-action');
    assert.equal(model.classifyLists(lists, data, ids).categories.get('tt1'), 'live-action');
});

test('playback shortcuts map to fixed actions only while playing and outside text fields', () => {
    const handlers = {};
    const messages = [];
    const window = {
        addEventListener: (event, handler) => { handlers[event] = handler; },
        chrome: {webview:{postMessage: text => messages.push(JSON.parse(text).args)}},
    };
    window.top = window;
    const location = {origin:'https://web.stremio.com', hash:'#/player/example'};
    vm.runInNewContext(fs.readFileSync(path.join(assets, 'custom.js'), 'utf8'), {
        window, location, document:{readyState:'loading', addEventListener() {}},
    });
    const key = (code, patch) => handlers.keydown({
        code, ctrlKey:true, target:{}, preventDefault() {}, stopImmediatePropagation() {}, ...patch,
    });
    key('KeyB');
    key('KeyC', {shiftKey:true});
    for (let i = 1; i <= 8; i++) key('Digit' + i);
    key('Digit7', {repeat:true});
    key('KeyB', {target:{closest: () => true}});
    key('KeyB', {altKey:true});
    location.hash = '#/library';
    key('KeyB');
    assert.deepEqual(messages, ['blur','detect','shader-1','shader-2','shader-3','shader-4','shader-5','shader-6','shader-7','clear']
        .map(action => ['ezra-playback', action]));
});

test('seven presets ship every shader referenced by a preset', () => {
    const presets = require(path.join(assets, 'presets.json'));
    assert.equal(presets.length, 7);
    assert.equal(presets.at(-1).label, 'FSR');
    for (const preset of presets)
        for (const file of preset.files)
            assert.ok(fs.statSync(path.join(assets, 'shaders', file)).size > 0);
});
