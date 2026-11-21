(() => {
    'use strict';
    // Adapt only the hosted Library, its card menu, and Board rows. Identify
    // their factories by the render contract instead of webpack module IDs.
    function install(factories, lists) {
        const modules = Object.entries(factories);
        const unique = predicate => {
            const matches = modules.filter(([, factory]) => predicate(factory.toString()));
            return matches.length === 1 ? matches[0] : null;
        };
        const library = unique(source => source.includes('["library-content"]') &&
            source.includes('.useNotifications') && source.includes('detailsVideosFirst:'));
        const card = unique(source => source.includes('"LIBRARY_PLAY"') &&
            source.includes('detailsVideosFirst') && source.includes('optionOnSelect:'));
        const board = unique(source => source.includes('["board-content"]') &&
            source.includes('["board-spotlight"]') && source.includes('onScroll:'));
        if (!library || !card || !board) return false;

        function scopedFactory(factory, wrapRequire, finish) {
            const scopedFactory = function (module, exports, require) {
                const scoped = new Proxy(require, {apply: (target, owner, args) =>
                    wrapRequire(Reflect.apply(target, owner, args))});
                factory.call(this, module, exports, scoped);
                finish?.(module);
            };
            // Keep the original contract visible to the independent artwork adapter.
            scopedFactory.toString = () => factory.toString();
            return scopedFactory;
        }

        const isReact = exports => typeof exports?.createElement === 'function' && typeof exports.useEffect === 'function';
        let components, styles, profile, notifications;
        factories[library[0]] = scopedFactory(library[1], loaded => {
            if (loaded?.MainNavBars && loaded.LibItem) components = loaded;
            if (loaded?.['library-content'] && loaded['meta-items-container']) styles = loaded;
            if (typeof loaded?.useProfile === 'function' && typeof loaded.useNotifications === 'function') {
                return {...loaded,
                    useProfile(...args) { return (profile = loaded.useProfile(...args)); },
                    useNotifications(...args) { return (notifications = loaded.useNotifications(...args)); },
                };
            }
            if (typeof loaded?.useNavigate === 'function' && typeof loaded.useLocation === 'function') {
                return {...loaded, useNavigate(...args) {
                    const navigate = loaded.useNavigate(...args);
                    return (...params) => { if (!lists.hasListRoute()) return navigate(...params); };
                }};
            }
            if (!isReact(loaded)) return loaded;
            return {...loaded, createElement(type, props, ...children) {
                if (type !== components?.MainNavBars || props?.route !== 'library' || !styles)
                    return loaded.createElement(type, props, ...children);
                return lists.library(loaded, type, components.LibItem, notifications, styles, profile,
                    props, children[0]);
            }};
        });

        let cardHandler;
        function wrapCard(component) {
            if (component?.$$typeof === Symbol.for('react.memo')) {
                const type = wrapCard(component.type);
                return type === component.type ? component : {...component, type};
            }
            if (typeof component !== 'function') return component;
            return Object.assign(function EzraLibraryCard(props) {
                const previous = cardHandler;
                cardHandler = props.optionOnSelect;
                try { return component(props); }
                finally { cardHandler = previous; }
            }, component);
        }
        factories[card[0]] = scopedFactory(card[1], loaded => {
            if (!isReact(loaded)) return loaded;
            return {...loaded, createElement(type, props, ...children) {
                if (cardHandler && Array.isArray(props?.options) && typeof props.optionOnSelect === 'function') {
                    props = {...props, options: lists.menu(props.options, cardHandler)};
                }
                return loaded.createElement(type, props, ...children);
            }};
        }, module => {
            module.exports = wrapCard(module.exports);
        });

        factories[board[0]] = scopedFactory(board[1], loaded => {
            if (!isReact(loaded)) return loaded;
            return {...loaded, createElement(type, props, ...children) {
                if (type === 'div' && typeof props?.className === 'string' &&
                    props.className.startsWith('board-content-') && typeof props.onScroll === 'function')
                    return lists.home(loaded, props, ...children);
                return loaded.createElement(type, props, ...children);
            }};
        });
        return true;
    }

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = {install};
    } else if (window === window.top && location.origin === 'https://web.stremio.com' &&
        window.__stremioForkLists) {
        window.__stremioForkCustomListsPatched = false;
        (window.webpackChunkstremio ||= []).push([['ezra-library'], {}, require => {
            try {
                window.__stremioForkCustomListsPatched = install(require.m, window.__stremioForkLists);
            } catch (error) {
                console.error('Ezra Library could not adapt to this Stremio interface.', error);
            } finally {
                window.dispatchEvent(new Event('stremio-fork-compatibility'));
            }
        }]);
    }
})();
