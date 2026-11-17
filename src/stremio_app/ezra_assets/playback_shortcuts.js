(() => {
    'use strict';
    if (window !== window.top || location.origin !== 'https://web.stremio.com' || !window.chrome?.webview) return;
    window.addEventListener('keydown', event => {
        if (!/^#\/player(?:\/|$)/.test(location.hash) || !event.ctrlKey || event.altKey || event.metaKey ||
            event.isComposing || event.target.closest?.('input, textarea, select, [contenteditable], [role="textbox"]')) return;
        const key = event.code;
        const action = event.shiftKey ? (key === 'KeyC' ? 'detect' : null) :
            key === 'KeyB' ? 'blur' : key === 'Digit8' ? 'clear' :
            /^Digit[1-7]$/.test(key) ? 'shader-' + key.at(-1) : null;
        if (!action) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!event.repeat) window.chrome.webview.postMessage(JSON.stringify({id: 1, args: ['ezra-playback', action]}));
    }, true);
})();
