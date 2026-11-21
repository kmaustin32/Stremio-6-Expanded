(() => {
    'use strict';
    const missing = 'data:image/png;base64,';
    const urls = (...values) => [...new Set(values.flat(Infinity).map(value =>
        typeof value === 'string' ? value.trim() : value?.src).filter(value =>
        typeof value === 'string' && value.length > 0 && value !== missing))];
    const alternatives = item => urls(item?.altThumbnail, item?.alternativeThumbnail, item?.thumbnails,
        item?.altPoster, item?.alternativePoster, item?.posters);

    function install(factories) {
        const entries = Object.entries(factories);
        const images = entries.filter(([, factory]) => {
            const source = factory.toString();
            return source.includes('fallbackSrc') && source.includes('renderFallback') && source.includes('onError:');
        });
        if (images.length !== 1) return false;
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
                return libraryItems[id];
            } catch (_) { return null; }
        }
        function derive(props, parent) {
            const show = props.metaItem || props.meta || savedItem(props._id || props.id) || parent.show;
            const video = props.nextVideo || props.video ||
                show?.videos?.find(item => item.id === props.id) || props;
            const candidates = urls(video.thumbnail, alternatives(video), alternatives(props),
                props.fallbackSrc, props.poster, show?.poster, props.background, show?.background);
            return {show, candidates: urls(candidates, parent.candidates), failed: parent.failed};
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
                    ? {...props, thumbnail: context.candidates[0] || missing} : props;
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
            const sources = urls(src, isArtwork ? context.candidates : [], fallbackSrc);
            const identity = JSON.stringify(sources);
            const current = React.useRef(identity);
            current.current = identity;
            const [failure, setFailure] = React.useState({identity, urls: []});
            const failed = failure.identity === identity ? failure.urls : [];
            const source = sources.find(url => !failed.includes(url) && !context.failed?.includes(url));
            if (!source) return typeof renderFallback === 'function'
                ? React.createElement(Context.Provider, {value: {...context,
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
