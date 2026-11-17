(() => {
    'use strict';
    const defaults = [
        {id: 'anime', name: 'Anime', items: []},
        {id: 'live-action', name: 'Live Action', items: []}
    ];
    const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
    const newDefaults = () => defaults.map(list => ({...list, items: []}));
    const categoryIds = new Set(defaults.map(list => list.id));
    const reservedListIds = new Set(['all', 'most-watched', 'watched', 'not-watched']);
    function decodeLists(raw) {
        if (raw === null) return newDefaults();
        const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (data?.version !== 1 || !Array.isArray(data.lists)) throw new Error('Saved lists could not be read.');
        const ids = new Set();
        const lists = data.lists.map(list => {
            if (!object(list) || typeof list.id !== 'string' || !/^[a-z0-9-]+$/.test(list.id) ||
                ids.has(list.id) || typeof list.name !== 'string' || !list.name.trim() ||
                !Array.isArray(list.items) || !list.items.every(id => typeof id === 'string' && id))
                throw new Error('Saved lists could not be read.');
            ids.add(list.id);
            return {...list, items: [...new Set(list.items)]};
        });
        for (const [index, list] of newDefaults().entries()) {
            if (!ids.has(list.id)) lists.splice(index, 0, list);
        }
        return lists;
    }

    function previewListImport(current, saved) {
        const incoming = decodeLists(saved);
        const result = current.map(list => ({...list, items: [...list.items]}));
        const rows = [];
        for (const list of incoming) {
            if (reservedListIds.has(list.id)) throw new Error('A list ID is reserved.');
            if (!categoryIds.has(list.id) && list.name.trim().length > 60) throw new Error('A list name is too long.');
            const target = result.find(item => item.id === list.id || (!categoryIds.has(item.id) &&
                !categoryIds.has(list.id) && item.name.trim().toLowerCase() === list.name.trim().toLowerCase()));
            const members = new Set(target?.items ?? []);
            const otherCategory = categoryIds.has(list.id) && result.find(item => item.id !== list.id && categoryIds.has(item.id));
            const conflicting = new Set(otherCategory?.items ?? []);
            let added = 0;
            for (const id of list.items) {
                if (members.has(id) || conflicting.has(id)) continue;
                members.add(id);
                added++;
            }
            if (target) target.items = [...members];
            else result.push({id: list.id, name: list.name.trim(), home: list.home !== false, items: [...members]});
            if (added || !target) rows.push({name: target?.name ?? list.name.trim(), action: target ? 'Merge' : 'Add', added});
        }
        return {lists: result, rows};
    }

    function imdbIds(index) {
        const ids = new Set();
        if (object(index)) {
            for (const [key, entry] of Object.entries(index)) {
                if (!Array.isArray(entry?.['anime-list']) || !entry['anime-list'].length) continue;
                for (const id of key.replace(/^\[|\]$/g, '').split(',').map(value => value.trim())) {
                    if (/^tt\d+$/.test(id)) ids.add(id);
                }
            }
        }
        return ids;
    }

    function automaticCategory(item, ids) {
        return item.type === 'anime' || /^(?:kitsu|mal|anilist|anidb):\d+$/.test(item._id) || ids?.has(item._id)
            ? 'anime' : 'live-action';
    }

    function classifyLists(lists, records, ids) {
        const categories = new Map();
        // Beta 1 stored manual picks in the two built-in lists. Honor them
        // directly, with Anime taking priority if a title was in both.
        for (const category of ['live-action', 'anime']) {
            const list = lists.find(list => list.id === category);
            for (const id of list?.items ?? []) categories.set(id, category);
        }
        const members = new Map(defaults.map(list => [list.id, []]));
        for (const item of records.values()) {
            const category = categories.get(item._id) ?? automaticCategory(item, ids);
            categories.set(item._id, category);
            members.get(category).push(item._id);
        }
        return {categories, lists: lists.map(list => members.has(list.id) ? {...list, items: members.get(list.id)} : list)};
    }

    function moveTitles(lists, ids, destination) {
        const moved = new Set(ids);
        for (const list of lists) {
            if (!categoryIds.has(list.id)) continue;
            list.items = list.items.filter(id => !moved.has(id));
            if (list.id === destination) list.items.push(...moved);
        }
    }

    function crc(data) {
        let value = 0xffffffff;
        for (const byte of data) {
            value ^= byte;
            for (let i = 0; i < 8; ++i) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
        }
        return (value ^ 0xffffffff) >>> 0;
    }

    function readListBackup(buffer) {
        if (buffer.byteLength > 48 * 1024 * 1024) throw new Error('This backup is too large.');
        const bytes = new Uint8Array(buffer), view = new DataView(buffer);
        const decode = new TextDecoder('utf-8', {fatal: true});
        let json = bytes;
        if (view.byteLength >= 4 && view.getUint32(0, true) === 0x04034b50) {
            json = null;
            let offset = 0;
            while (offset + 30 <= bytes.length && view.getUint32(offset, true) === 0x04034b50) {
                const flags = view.getUint16(offset + 6, true), method = view.getUint16(offset + 8, true);
                const size = view.getUint32(offset + 18, true), nameLength = view.getUint16(offset + 26, true);
                const start = offset + 30 + nameLength + view.getUint16(offset + 28, true);
                const next = start + size;
                if (flags & ~0x800 || method || size !== view.getUint32(offset + 22, true) || next > bytes.length)
                    throw new Error('Choose a ZIP created by Ezraâ€™s Stremio.');
                if (decode.decode(bytes.subarray(offset + 30, offset + 30 + nameLength)) === 'Backup.json') {
                    if (json) throw new Error('This ZIP contains more than one Backup.json.');
                    json = bytes.subarray(start, next);
                    if (crc(json) !== view.getUint32(offset + 14, true)) throw new Error('Backup.json is damaged.');
                }
                offset = next;
            }
        }
        if (!json) throw new Error('Backup.json is missing.');
        const backup = JSON.parse(decode.decode(json));
        if (backup?.format !== 'ezras-stremio-backup' || backup.version !== 1 || !backup.customLists)
            throw new Error('This backup does not contain custom Library lists.');
        return backup.customLists;
    }

    const model = {decodeLists, previewListImport, imdbIds, classifyLists, moveTitles, readListBackup};
    if (typeof module !== 'undefined' && module.exports) module.exports = model;
    else window.__ezraLibraryModel = model;
})();
