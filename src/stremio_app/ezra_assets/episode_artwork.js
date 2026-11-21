(() => {
    'use strict';
    function imdbId(video, show) {
        const ids = new Set();
        for (const value of [show?.imdb_id, show?.imdbId, show?.id, show?._id, video?.id]) {
            const match = typeof value === 'string' && /^(tt\d+)(?=:|$)/.exec(value);
            if (match) ids.add(match[1]);
        }
        return ids.size === 1 ? [...ids][0] : null;
    }
    function absoluteNumber(video, show) {
        if (!Number.isSafeInteger(video?.season) || video.season <= 1 ||
            !Number.isSafeInteger(video.episode) || video.episode < 1 || !Array.isArray(show?.videos)) return null;
        let offset = 0;
        for (let season = 1; season < video.season; season++) {
            const episodes = new Set(show.videos.filter(item => item.season === season &&
                Number.isSafeInteger(item.episode) && item.episode > 0).map(item => item.episode));
            if (!episodes.size || !episodes.has(1) || Math.max(...episodes) !== episodes.size) return null;
            offset += episodes.size;
        }
        return offset + video.episode;
    }
    function sources(video, show) {
        const id = imdbId(video, show);
        if (!id || !Number.isSafeInteger(video?.season) || video.season < 0 ||
            !Number.isSafeInteger(video.episode) || video.episode < 0) return [];
        const base = `https://episodes.metahub.space/${id}`;
        const candidates = [`${base}/${video.season}/${video.episode}/w780.jpg`];
        const absolute = absoluteNumber(video, show);
        if (absolute !== null) candidates.push(`${base}/1/${absolute}/w780.jpg`);
        return candidates;
    }
    function createLookup(fetcher, now = Date.now) {
        const cache = new Map();
        return id => {
            if (!/^tt\d+$/.test(id)) return Promise.resolve(null);
            const previous = cache.get(id);
            if (previous && previous.expires > now()) return previous.promise;
            if (cache.size >= 64) cache.delete(cache.keys().next().value);
            const entry = {expires:now() + 60000};
            entry.promise = (async () => {
                const controller = new AbortController();
                const timer = setTimeout(() => controller.abort(),5000);
                try {
                    const response = await fetcher(`https://v3-cinemeta.strem.io/meta/series/${id}.json`,
                        {credentials:'omit',referrerPolicy:'no-referrer',signal:controller.signal});
                    if (!response.ok) return null;
                    const {meta} = await response.json();
                    if (imdbId(null,meta) !== id || !Array.isArray(meta.videos)) return null;
                    entry.expires = now() + 15 * 60000;
                    return {id,videos:meta.videos.filter(item=>item && typeof item === 'object').map(item=>({
                        id:item.id,season:item.season,episode:item.episode,thumbnail:item.thumbnail,altThumbnail:item.altThumbnail,
                    }))};
                } catch (_) { return null; }
                finally { clearTimeout(timer); }
            })();
            cache.set(id,entry);
            return entry.promise;
        };
    }
    const api = {imdbId,absoluteNumber,sources,createLookup};
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else if (window === window.top && location.origin === 'https://web.stremio.com')
        window.__stremioExpandedEpisodeArtwork = {...api,lookup:createLookup(window.fetch.bind(window))};
})();
