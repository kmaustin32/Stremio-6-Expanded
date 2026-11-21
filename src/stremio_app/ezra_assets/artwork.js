(() => {
    'use strict';
    const episodeArt = typeof module !== 'undefined' && module.exports
        ? require('./episode_artwork.js') : window.__stremioExpandedEpisodeArtwork;
    const lookup = episodeArt && (episodeArt.lookup || episodeArt.createLookup((...args)=>globalThis.fetch(...args)));
    const missing = 'data:image/png;base64,';
    const urls = (...values) => [...new Set(values.flat(Infinity).map(value =>
        typeof value === 'string' ? value.trim() : value?.src).filter(value =>
        typeof value === 'string' && value.length > 0 && value !== missing))];
    const alternatives = item => urls(item?.altThumbnail, item?.alternativeThumbnail, item?.thumbnails,
        item?.altPoster, item?.alternativePoster, item?.posters);
    const thumbnails = item => urls(item?.altThumbnail, item?.alternativeThumbnail, item?.thumbnails);

    function install(factories) {
        const entries = Object.entries(factories);
        const images = entries.filter(([, factory]) => {
            const source = factory.toString();
            return source.includes('fallbackSrc') && source.includes('renderFallback') && source.includes('onError:');
        });
        if (images.length !== 1 || !episodeArt) return false;
        const imageId = images[0][0];
        let React, Context;
        const captureReact = loaded => {
            if (!React && typeof loaded?.createElement === 'function' && typeof loaded.createContext === 'function') {
                React = loaded;
                Context = React.createContext({});
            }
            return loaded;
        };
        let libraryRaw, libraryItems = {}, libraryRead = false;
        function savedItem(id) {
            if (!id || typeof localStorage === 'undefined') return null;
            try {
                // Read once per render batch rather than copying the entire Library per card.
                if (!libraryRead) {
                    libraryRead = true;
                    Promise.resolve().then(() => { libraryRead = false; });
                    const raw = localStorage.getItem('library');
                    if (raw !== libraryRaw) {
                        libraryRaw = raw;
                        libraryItems = JSON.parse(raw)?.items || {};
                    }
                }
                return libraryItems[id] || libraryItems[episodeArt.imdbId({id},null)];
            } catch (_) { return null; }
        }
        function derive(props, parent) {
            const show = props.metaItem || props.meta || savedItem(props._id || props.id) || parent.show;
            const sameShow = !show?.id || !parent.show?.id || show.id === parent.show.id;
            const episode = props.nextVideo || props.video ||
                (Array.isArray(show?.videos) && show.videos.find(item => item.id === props.id)) ||
                (Number.isSafeInteger(props.season) && Number.isSafeInteger(props.episode) ? props : null) ||
                (sameShow ? parent.episode : null);
            const specific = episode ? urls(episode.thumbnail, thumbnails(episode), thumbnails(props),episodeArt.sources(episode,show))
                : alternatives(props);
            const generic = urls(props.poster,show?.poster,props.background,show?.background,sameShow ? parent.generic : []);
            // Inherit show artwork, never another episode's thumbnail.
            return {show,episode,specific,generic,candidates:urls(specific,generic),failed:parent.failed};
        }
        function wrap(component, needsThumbnail) {
            if (component?.$$typeof === Symbol.for('react.memo'))
                return {...component, type: wrap(component.type, needsThumbnail)};
            const forwarded = component?.$$typeof === Symbol.for('react.forward_ref');
            if (typeof component !== 'function' && !forwarded) return component;
            const Wrapped = React.forwardRef((props, ref) => {
                const parent = React.useContext(Context);
                const context = derive(props, parent);
                // Some native episode views omit the entire image when its URL is absent.
                // The marker reaches our Image component without making a network request.
                const supplied = needsThumbnail && !urls(props.thumbnail).length
                    ? {...props, thumbnail: context.specific[0] || missing} : props;
                return React.createElement(Context.Provider, {value: context},
                    React.createElement(component, forwarded || ref ? {...supplied, ref} : supplied));
            });
            for (const key of Object.keys(component))
                if (key !== '$$typeof' && key !== 'render') Wrapped[key] = component[key];
            Wrapped.displayName = component.displayName || component.name || 'ArtworkContext';
            return Wrapped;
        }
        function ArtworkImage({src, fallbackSrc, renderFallback, ...props}) {
            const context = React.useContext(Context);
            const isArtwork = /(?:poster-image|thumbnail|artwork|still|\bimage-)/.test(props.className || '');
            const episode = isArtwork ? context.episode : null;
            const id = episodeArt.imdbId(episode,context.show);
            const [catalog,setCatalog] = React.useState({id:null,done:false,meta:null});
            const metadata = catalog.id === id ? catalog.meta : null;
            const matching = metadata?.videos.find(item=>item.season === episode?.season && item.episode === episode?.episode);
            const generic = isArtwork ? urls(context.generic,fallbackSrc) : urls(fallbackSrc);
            const specific = urls(episode && generic.includes(src) ? [] : src,
                isArtwork ? context.specific : [],matching?.thumbnail,thumbnails(matching),
                metadata ? episodeArt.sources(episode,metadata) : []);
            const identity = JSON.stringify([src,context.episode?.id,context.episode?.season,context.episode?.episode,
                context.specific,context.generic,fallbackSrc]);
            const current = React.useRef(identity);
            current.current = identity;
            const [failure, setFailure] = React.useState({identity, urls: []});
            const failed = failure.identity === identity ? failure.urls : [];
            const available = url => !failed.includes(url) && !context.failed?.includes(url);
            const primary = specific.find(available);
            const wantsCatalog = Boolean(!primary && episode?.season > 1 && id &&
                episodeArt.absoluteNumber(episode,context.show) === null && !(catalog.id === id && catalog.done));
            React.useEffect(() => {
                if (!wantsCatalog) return;
                let active = true;
                lookup(id).then(meta => { if (active) setCatalog({id,done:true,meta}); });
                return () => { active = false; };
            },[id,wantsCatalog]);
            if (wantsCatalog) return React.createElement('span',{className:props.className,style:props.style,'aria-hidden':true});
            const source = primary || generic.find(available);
            if (!source) return typeof renderFallback === 'function'
                ? React.createElement(Context.Provider, {value: {...context,show:metadata || context.show,
                    failed: urls(context.failed, failed)}}, renderFallback()) : null;
            return React.createElement('img', {...props, src: source, loading: props.loading || 'lazy',
                onError(event) {
                    // Ignore a late failure from an earlier episode/source.
                    if (current.current !== identity) return;
                    setFailure(previous => ({identity, urls: urls(previous.identity === identity ? previous.urls : [], source)}));
                    props.onError?.(event);
                }});
        }
        for (const [id, factory] of entries) {
            const source = factory.toString();
            const artwork = source.includes('createElement') && /(?:metaItem|poster|thumbnail|LIBRARY_PLAY)/.test(source);
            if (id !== imageId && !artwork) continue;
            const needsThumbnail = source.includes('shouldScroll') && source.includes('seasonWatched') ||
                source.includes('thumbnail') && source.includes('blurred') && source.includes('renderFallback') && source.includes('.still');
            factories[id] = function(module, exports, require) {
                const scoped = new Proxy(require, {apply: (target, owner, args) =>
                    captureReact(Reflect.apply(target, owner, args))});
                factory.call(this, module, exports, scoped);
                if (!React) return;
                if (id === imageId) module.exports.default = ArtworkImage;
                else if (module.exports?.default) module.exports.default = wrap(module.exports.default, needsThumbnail);
                else module.exports = wrap(module.exports, needsThumbnail);
            };
            factories[id].toString = () => source;
        }
        return true;
    }
    if (typeof module !== 'undefined' && module.exports) module.exports = {install, urls};
    else if (window === window.top && location.origin === 'https://web.stremio.com') {
        (window.webpackChunkstremio ||= []).push([['expanded-artwork'], {}, require => {
            try { window.__stremioExpandedArtwork = install(require.m); }
            catch (error) { console.error('Artwork compatibility check failed.', error); }
        }]);
    }
})();
