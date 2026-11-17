(() => {
    'use strict';
    if (window !== window.top || location.origin !== 'https://web.stremio.com' ||
        window.__ezraCustomStarted || !window.chrome?.webview) return;
    window.__ezraCustomStarted = true;
    const model = window.__ezraLibraryModel;
    const themeKey = 'ezra.custom.theme';
    const watchedColorKey = 'ezra.custom.watched-color';
    const watchedColors = new Map([
        ['#dea066', 'Amber'], ['#7272c2', 'Purple'], ['#61d1c7', 'Teal'],
        ['#e08eb3', 'Dusty rose'], ['#b6d283', 'Sage'],
    ]);
    const libraryPath = () => /^#\/library(?:[/?]|$)/.test(location.hash);
    const playerPath = () => /^#\/player(?:\/|$)/.test(location.hash);
    let activeDialog;

    // Use the shell's scoped playback messages. Official Fit/Fill/Stretch and
    // other player shortcuts continue to be handled by the hosted player.
    window.addEventListener('keydown', event => {
        if (!playerPath() || !event.ctrlKey || event.altKey || event.metaKey || event.isComposing ||
            event.target.closest?.('input, textarea, select, [contenteditable], [role="textbox"]')) return;
        const key = event.code;
        const action = event.shiftKey ? (key === 'KeyC' ? 'detect' : null) :
            key === 'KeyB' ? 'blur' : key === 'Digit8' ? 'clear' :
            /^Digit[1-7]$/.test(key) ? 'shader-' + key.at(-1) : null;
        if (!action) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!event.repeat) window.chrome.webview.postMessage(JSON.stringify({id: 1, args: ['ezra-playback', action]}));
    }, true);

    function element(tag, text, attrs = {}) {
        const node = document.createElement(tag);
        if (text) node.textContent = text;
        for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
        return node;
    }

    function button(label, click) {
        const node = element('button', label, {type: 'button'});
        node.addEventListener('click', click);
        return node;
    }

    function applyTheme() {
        document.documentElement.toggleAttribute('data-ezra-theme', localStorage.getItem(themeKey) !== 'off');
        document.documentElement.toggleAttribute('data-ezra-playing', playerPath());
        const color = localStorage.getItem(watchedColorKey);
        document.documentElement.style.setProperty('--ezra-watched-color', watchedColors.has(color) ? color : '#dea066');
    }

    function openTheme() {
        const dialog = element('dialog', null, {class: 'ezra-dialog', 'aria-label': 'Ezra color theme'});
        const heading = element('h2', 'Ezra color theme');
        const field = element('label', 'Use Ezra’s dark gradient and purple accent');
        const choice = element('input', null, {type: 'checkbox'});
        choice.checked = localStorage.getItem(themeKey) !== 'off';
        choice.onchange = () => {
            localStorage.setItem(themeKey, choice.checked ? 'on' : 'off');
            applyTheme();
        };
        field.prepend(choice);
        const color = options(watchedColors, 'Watched color');
        const saved = localStorage.getItem(watchedColorKey);
        color.value = watchedColors.has(saved) ? saved : '#dea066';
        color.onchange = () => {
            localStorage.setItem(watchedColorKey, color.value);
            applyTheme();
        };
        const watched = element('label', 'Watched color');
        watched.append(color);
        dialog.append(heading, field, watched, button('Done', () => dialog.close()));
        dialog.addEventListener('close', () => dialog.remove(), {once: true});
        document.body.append(dialog);
        dialog.showModal();
    }

    function account(ctx) {
        const user = ctx?.profile?.auth?.user;
        const id = user?._id ?? user?.id;
        return typeof id === 'string' && id ? id : null;
    }

    const storageKey = id => 'stremio-fork-custom-lists:' + encodeURIComponent(id);
    const read = id => model.decodeLists(localStorage.getItem(storageKey(id)));
    const idOf = item => item?._id;
    const watched = item => item.watched === true || Number(item.state?.timesWatched) > 0;
    const watchedAt = item => Date.parse(item.state?.lastWatched ?? item.state?.last_watched ?? item._mtime ?? '') || 0;
    const timesWatched = item => Number(item.state?.timesWatched ?? item.timesWatched) || Number(watched(item));

    function details(item) {
        for (const link of [item.deepLinks?.metaDetailsVideos, item.deepLinks?.metaDetailsStreams]) {
            if (typeof link !== 'string') continue;
            const path = link.replace(/^stremio:\/\/+/, '/').replace(/^#/, '');
            if (path.startsWith('/detail/')) return '#' + path;
        }
        return '#/detail/' + encodeURIComponent(item.type) + '/' + encodeURIComponent(item._id);
    }

    async function readLibrary(core, current, cancelled) {
        const records = new Map();
        for (let page = 0; page < 200 && !cancelled(); page++) {
            if (!Array.isArray(current?.catalog)) throw new Error('The Stremio Library is unavailable.');
            for (const item of current.catalog) {
                if (typeof idOf(item) === 'string' && typeof item.name === 'string') records.set(item._id, item);
            }
            if (!current.selectable?.nextPage) return records;
            await core.dispatch({action: 'LibraryWithFilters', args: {action: 'LoadNextPage'}}, 'library');
            let advanced = false;
            for (let attempt = 0; attempt < 25 && !cancelled(); attempt++) {
                await new Promise(resolve => setTimeout(resolve, 100));
                const next = await core.getState('library');
                if (!next?.selectable?.nextPage || next.catalog?.some(item => !records.has(idOf(item)))) {
                    current = next;
                    advanced = true;
                    break;
                }
            }
            if (!advanced && !cancelled()) throw new Error('Stremio could not finish loading the Library. Try again.');
        }
        if (cancelled()) return records;
        throw new Error('The Library has too many pages to load at once.');
    }

    const indexUrl = 'https://raw.githubusercontent.com/Fribb/anime-lists/master/indices/imdb_index.json';
    let indexPromise;
    function loadAnimeIndex() {
        indexPromise ??= fetch(indexUrl, {credentials: 'omit', referrerPolicy: 'no-referrer',
            signal: AbortSignal.timeout(8000)}).then(response => {
                if (!response.ok) throw new Error('Anime index unavailable.');
                return response.json();
            }).then(model.imdbIds).catch(() => null);
        return indexPromise;
    }

    function options(items, label) {
        const select = element('select', null, {'aria-label': label});
        for (const [value, text] of items) select.append(element('option', text, {value}));
        return select;
    }

    function formDialog(title, content, submitLabel, finish) {
        const dialog = element('dialog', null, {class: 'ezra-dialog', 'aria-label': title});
        const form = element('form');
        const error = element('p', null, {role: 'alert'});
        const submit = element('button', submitLabel, {type: 'submit'});
        form.append(element('h2', title), content, error, button('Cancel', () => dialog.close()), submit);
        form.onsubmit = async event => {
            event.preventDefault();
            submit.disabled = true;
            try { await finish(); if (dialog.open) dialog.close(); }
            catch (failure) { error.textContent = failure.message; submit.disabled = false; }
        };
        dialog.append(form);
        dialog.addEventListener('close', () => dialog.remove(), {once: true});
        document.body.append(dialog);
        dialog.showModal();
        return dialog;
    }

    async function openLibrary() {
        if (activeDialog?.open) return;
        const dialog = element('dialog', null, {class: 'ezra-dialog ezra-library', 'aria-label': 'Library lists'});
        activeDialog = dialog;
        const header = element('header');
        header.append(element('h2', 'Library lists'), button('Close', () => dialog.close()));
        const status = element('p', 'Loading Library…', {role: 'status'});
        dialog.append(header, status);
        dialog.addEventListener('close', () => {dialog.remove(); activeDialog = null;}, {once: true});
        document.body.append(dialog);
        dialog.showModal();
        const cancelled = () => !dialog.open || !libraryPath();
        try {
            const core = window.core;
            if (!core) throw new Error('Stremio is still starting. Try again in a moment.');
            const uid = account(await core.getState('ctx'));
            if (!uid) throw new Error('Sign in to use custom Library lists.');
            let state = await core.getState('library');
            if (state?.selected?.request?.type || /^(?:watched|notwatched|unwatched)$/i.test(state?.selected?.request?.sort ?? '')) {
                const all = state.selectable?.types?.find(item => item.type === null)?.deepLinks?.library;
                const hash = typeof all === 'string' && /(?:#\/|stremio:\/+)library/.test(all) ?
                    all.replace(/^stremio:\/\/+/, '#/') : '#/library';
                location.hash = hash.startsWith('#') ? hash : '#/library';
                for (let retry = 0; retry < 25 && !cancelled(); retry++) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                    state = await core.getState('library');
                    if (state?.selected && !state.selected.request?.type &&
                        !/^(?:watched|notwatched|unwatched)$/i.test(state.selected.request?.sort ?? '')) break;
                }
                if (!cancelled() && (!state?.selected || state.selected.request?.type ||
                    /^(?:watched|notwatched|unwatched)$/i.test(state.selected.request?.sort ?? '')))
                    throw new Error('Open the All view in Stremio’s Library and try again.');
            }
            const saved = read(uid);
            const records = await readLibrary(core, state, cancelled);
            if (cancelled()) return;
            buildLibrary(dialog, status, uid, saved, records, core);
        } catch (error) {
            if (dialog.open) status.textContent = error.message;
        }
    }

    function buildLibrary(dialog, status, uid, saved, records, core) {
        let lists = saved, active = 'all', animeIndex;
        const selected = new Set();
        const controls = element('div', null, {class: 'ezra-list-controls'});
        const listSelect = options([], 'List');
        const sort = options([['recent','Last watched'], ['az','A–Z'], ['za','Z–A'], ['most','Most watched']], 'Sort');
        const filter = options([['all','Any watch status'], ['watched','Watched'], ['unwatched','Not watched']], 'Watch status');
        const types = options([['all','All types'], ['movie','Movies'], ['series','Series']], 'Type');
        const grid = element('div', null, {class: 'ezra-list-grid'});
        const category = id => id === 'anime' || id === 'live-action';

        async function save(change) {
            if (!dialog.open || account(await core.getState('ctx')) !== uid) throw new Error('The signed-in account changed.');
            const next = read(uid);
            const result = change(next) ?? next;
            localStorage.setItem(storageKey(uid), JSON.stringify({version: 1, lists: result}));
            lists = result;
            render();
        }

        function assign(ids) {
            const rows = element('div', null, {class: 'ezra-assignment'});
            const choices = [];
            for (const list of lists) {
                const row = element('label', list.name);
                const check = element('input', null, {type: 'checkbox'});
                if (category(list.id)) {
                    check.type = 'radio';
                    check.name = 'ezra-category';
                }
                row.prepend(check);
                rows.append(row);
                choices.push([list.id, check]);
            }
            formDialog('Add to lists', rows, 'Add', async () => {
                const checked = choices.filter(([, box]) => box.checked).map(([id]) => id);
                if (!checked.length) throw new Error('Choose a list.');
                await save(next => {
                    for (const list of next) {
                        if (!checked.includes(list.id)) continue;
                        if (category(list.id)) model.moveTitles(next, ids, list.id);
                        else list.items = [...new Set([...list.items, ...ids])];
                    }
                });
            });
        }

        function createList() {
            const input = element('input', null, {type: 'text', maxlength: '60', required: '', 'aria-label': 'List name'});
            formDialog('Create list', input, 'Create', async () => {
                const name = input.value.trim();
                if (!name) throw new Error('Enter a list name.');
                await save(next => {
                    if (next.some(list => list.name.toLowerCase() === name.toLowerCase())) throw new Error('That list name is already in use.');
                    const id = crypto.randomUUID();
                    next.push({id, name, items: []});
                    active = id;
                });
            });
        }

        function manageList() {
            const list = lists.find(list => list.id === active);
            if (!list || category(list.id)) return;
            const field = element('div');
            const input = element('input', null, {type:'text', maxlength:'60', required:'', 'aria-label':'List name'});
            input.value = list.name;
            const edit = formDialog('Manage list', field, 'Rename', async () => {
                const name = input.value.trim();
                if (!name) throw new Error('Enter a list name.');
                await save(next => {
                    if (next.some(entry => entry.id !== list.id && entry.name.toLowerCase() === name.toLowerCase()))
                        throw new Error('That list name is already in use.');
                    next.find(entry => entry.id === list.id).name = name;
                });
            });
            field.append(input, button('Delete list…', () => {
                const message = element('p', 'Delete “' + list.name + '”? The titles will stay in your Stremio Library.');
                formDialog('Delete list', message, 'Delete', async () => {
                    active = 'all';
                    await save(next => next.filter(entry => entry.id !== list.id));
                    edit.close();
                });
            }));
        }

        function importLists() {
            const file = element('input', null, {type:'file', accept:'.zip,.json', required:'', 'aria-label':'Ezra’s Library backup'});
            formDialog('Import Ezra’s lists', file, 'Merge lists', async () => {
                const source = file.files?.[0];
                if (!source || source.size > 48 * 1024 * 1024) throw new Error('Choose an Ezra backup under 48 MB.');
                const incoming = model.readListBackup(await source.arrayBuffer());
                await save(next => model.previewListImport(next, incoming).lists);
            });
        }

        const add = button('Add selected to lists', () => assign([...selected]));
        const manage = button('Manage list', manageList);
        function render() {
            listSelect.replaceChildren(element('option', 'All', {value:'all'}),
                ...lists.map(list => element('option', list.name, {value:list.id})),
                element('option', 'Most Watched', {value:'most-watched'}));
            listSelect.value = active;
            const categoryLists = model.classifyLists(lists, records, animeIndex).lists;
            const members = categoryLists.find(list => list.id === active)?.items;
            const membership = members ? new Set(members) : null;
            const visible = [...records.values()].filter(item => (!membership || membership.has(item._id)) &&
                (active !== 'most-watched' || watched(item)) &&
                (types.value === 'all' || item.type === types.value || (types.value === 'series' && item.type === 'anime')) &&
                (filter.value === 'all' || watched(item) === (filter.value === 'watched')));
            const byName = (a,b) => a.name.localeCompare(b.name, undefined, {numeric:true, sensitivity:'base'});
            visible.sort((a,b) => sort.value === 'az' ? byName(a,b) : sort.value === 'za' ? byName(b,a) :
                sort.value === 'most' ? timesWatched(b) - timesWatched(a) || byName(a,b) :
                watchedAt(b) - watchedAt(a) || byName(a,b));
            const visibleIds = new Set(visible.map(item => item._id));
            for (const id of selected) if (!visibleIds.has(id)) selected.delete(id);
            add.disabled = !selected.size;
            manage.disabled = active === 'all' || active === 'most-watched' || category(active);
            status.textContent = visible.length + (visible.length === 1 ? ' title' : ' titles');
            grid.replaceChildren(...visible.map(item => {
                const card = element('article', null, {class:'ezra-list-card'});
                const link = element('a', item.name, {href:details(item)});
                link.onclick = event => {
                    if (event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) {
                        event.preventDefault();
                        if (selected.has(item._id)) selected.delete(item._id); else selected.add(item._id);
                        render();
                    } else if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) dialog.close();
                };
                const check = element('input', null, {type:'checkbox', 'aria-label':'Select ' + item.name});
                check.checked = selected.has(item._id);
                check.onchange = () => {
                    if (check.checked) selected.add(item._id); else selected.delete(item._id);
                    add.disabled = !selected.size;
                };
                card.append(check, link, button('Add to list…', () => assign([item._id])));
                if (members && !category(active)) card.append(button('Remove', async () => {
                    try { await save(next => { const list = next.find(entry => entry.id === active); list.items = list.items.filter(id => id !== item._id); }); }
                    catch (error) { status.textContent = error.message; }
                }));
                return card;
            }));
        }

        listSelect.onchange = () => {
            active = listSelect.value;
            if (active === 'most-watched') sort.value = 'most';
            selected.clear();
            render();
        };
        for (const field of [sort, filter, types]) field.onchange = render;
        controls.append(listSelect, sort, filter, types, button('Create list', createList), add, manage,
            button('Import lists…', importLists));
        dialog.insertBefore(controls, status);
        dialog.append(grid);
        render();
        loadAnimeIndex().then(result => { if (dialog.open && result) { animeIndex = result; render(); } });
    }

    function mount() {
        const libraryToolbar = libraryPath() && document.querySelector('[class*="library-content-"] [class*="selectable-inputs-container-"]');
        if (libraryToolbar && !libraryToolbar.querySelector('#ezra-library-lists')) {
            const listButton = button('Lists', openLibrary);
            listButton.id = 'ezra-library-lists';
            libraryToolbar.append(listButton);
        }
        const settings = /^#\/settings(?:[/?]|$)/.test(location.hash) &&
            document.querySelector('[class*="settings-content-"]');
        if (settings && !settings.querySelector('#ezra-theme-button')) {
            const theme = button('Ezra color theme', openTheme);
            theme.id = 'ezra-theme-button';
            settings.prepend(theme);
        }
    }

    function start() {
        const style = element('style', window.__ezraCustomCss);
        document.head.append(style);
        applyTheme();
        let pending = false;
        const schedule = () => {
            if (pending) return;
            pending = true;
            requestAnimationFrame(() => {pending = false; mount();});
        };
        new MutationObserver(schedule).observe(document.body, {childList:true, subtree:true});
        window.addEventListener('hashchange', () => {
            if (!libraryPath() && activeDialog?.open) activeDialog.close();
            applyTheme();
            schedule();
        });
        schedule();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {once:true});
    else start();
})();
