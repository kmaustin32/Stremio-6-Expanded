(() => {
    'use strict';
    const bridge = window.chrome?.webview;
    if (window !== window.top || location.origin !== 'https://web.stremio.com' || !bridge) return;

    const updateCommand = 'expanded-updates';
    const playerCommand = 'ezra-playback';
    const channelKey = 'stremio-expanded-update-channel';
    const presetNames = ['Off', 'Anime4K Mode A (HQ)', 'Anime4K Mode B (HQ)', 'Anime4K Mode C (HQ)',
        'Anime4K Mode A+A (HQ)', 'Anime4K Mode B+B (HQ)', 'Anime4K Mode C+A (HQ)', 'FSR'];
    const pending = new Map();
    const navigation = window.navigation && 'oncurrententrychange' in window.navigation ? window.navigation : null;
    let updatePanel, playbackButton, playbackDialog, observer, mountQueued;

    function element(tag, label) {
        const node = document.createElement(tag);
        if (label) node.textContent = label;
        return node;
    }

    function button(label, click) {
        const node = element('button', label);
        node.type = 'button';
        node.addEventListener('click', click);
        return node;
    }

    function send(...args) {
        bridge.postMessage(JSON.stringify({id: 1, args}));
    }

    function updateRequest(action, details) {
        return new Promise((resolve, reject) => {
            const requestId = crypto.randomUUID();
            const timeout = setTimeout(() => {
                pending.delete(requestId);
                reject(new Error('The app did not respond. Try again.'));
            }, action === 'download' ? 190000 : 25000);
            pending.set(requestId, result => {
                clearTimeout(timeout);
                if (result.error) reject(new Error(result.error));
                else resolve(result);
            });
            try { send(updateCommand, {action, requestId, ...details}); }
            catch (error) {
                pending.delete(requestId);
                clearTimeout(timeout);
                reject(error);
            }
        });
    }

    function versionLabel(version) {
        return version.replace(/-custom\.(\d+)$/, ' Beta $1');
    }

    function createUpdates() {
        const panel = element('section');
        panel.className = 'expanded-tools expanded-update-panel';
        panel.setAttribute('aria-label', 'Expanded updates');
        const title = element('h2', 'Stremio 6 Expanded');
        const row = element('div');
        row.className = 'expanded-tools-row';
        const channel = element('select');
        const channelLabel = element('label', 'Update channel ');
        channelLabel.append(channel);
        channel.append(new Option('Stable', 'stable'), new Option('Beta', 'beta'));
        const savedChannel = localStorage.getItem(channelKey);
        channel.value = savedChannel === 'beta' ? 'beta' : 'stable';
        const message = element('p');
        message.setAttribute('role', 'status');
        let available;
        let portable = false;
        const busy = value => { channel.disabled = check.disabled = next.disabled = value; };
        const check = button('Check for updates', async () => {
            busy(true);
            next.hidden = true;
            message.textContent = 'Checking GitHub for updates...';
            try {
                const result = await updateRequest('check', {channel: channel.value});
                available = result.available;
                message.textContent = available ? 'Available: ' + versionLabel(available) : 'You are up to date on this channel.';
                if (available) {
                    next.textContent = portable ? 'Download portable ZIP' : 'Download update';
                    next.dataset.action = 'download';
                    next.hidden = false;
                }
            } catch (error) { message.textContent = error.message; }
            finally { busy(false); }
        });
        const next = button('Download update', async () => {
            const action = next.dataset.action;
            busy(true);
            if (action === 'download') message.textContent = 'Downloading and verifying the update...';
            try {
                await updateRequest(action, {version: available});
                if (action === 'download') {
                    message.textContent = portable ? 'Verified ZIP saved to Downloads.' :
                        'Download verified. The app will close when you open the installer.';
                    next.textContent = portable ? 'Open download folder' : 'Close app and open installer';
                    next.dataset.action = 'open';
                }
            } catch (error) { message.textContent = error.message; }
            finally { busy(false); }
        });
        channel.addEventListener('change', () => {
            localStorage.setItem(channelKey, channel.value);
            available = undefined;
            next.hidden = true;
            message.textContent = '';
        });
        next.hidden = true;
        check.disabled = true;
        row.append(channelLabel, check, next);
        panel.append(title, row, message);
        updateRequest('info').then(info => {
            title.textContent += ' ' + versionLabel(info.version);
            portable = info.portable;
            if (savedChannel !== 'stable' && savedChannel !== 'beta' && !localStorage.getItem(channelKey) &&
                /-custom\./.test(info.version)) channel.value = 'beta';
            check.disabled = false;
        }).catch(error => { message.textContent = error.message; check.disabled = false; });
        return panel;
    }

    function reportText(report) {
        const number = value => Number.isFinite(value) ? value : 'Unavailable';
        const yesNo = value => typeof value === 'boolean' ? value ? 'Yes' : 'No' : 'Unavailable';
        return [
            'Stremio 6 Expanded ' + versionLabel(report.version),
            'Video: ' + report.resolution + ' / ' + (report.codec ?? 'Unknown codec') + ' / ' + number(report.fps) + ' fps',
            'Hardware decoder: ' + (report.hardwareDecoder ?? 'Inactive or unavailable'),
            'Video output: ' + (report.output ?? 'Unavailable'),
            'Dropped frames (renderer / decoder): ' + number(report.renderDropped) + ' / ' + number(report.decoderDropped),
            'Waiting for buffer: ' + yesNo(report.buffering),
            'Buffer fill: ' + (Number.isFinite(report.bufferPercent) ? report.bufferPercent + '%' : 'Unavailable'),
            'Buffered video: ' + (Number.isFinite(report.bufferSeconds) ? report.bufferSeconds.toFixed(2) + ' s' : 'Unavailable'),
            'Video filters active: ' + yesNo(report.videoFilters),
            'NVIDIA video scaling / HDR: ' + yesNo(report.gpuScaling) + ' / ' + yesNo(report.gpuHdr),
            'Upscaling: ' + report.upscaling,
            'Ambient blur: ' + yesNo(report.borderBlur),
            'Black-bar crop: ' + yesNo(report.blackBarCrop),
        ].join('\n');
    }

    function field(label, control) {
        const row = element('div');
        row.className = 'expanded-playback-field';
        row.append(label, control);
        return row;
    }

    function showPlayback() {
        if (playbackDialog?.open && playbackDialog.isConnected) return;
        playbackDialog?.dispose();
        const popup = element('dialog');
        popup.className = 'expanded-tools expanded-playback-dialog';
        popup.setAttribute('aria-label', 'Playback Tools');
        const title = element('h2', 'Playback Tools');
        const message = element('p', 'Waiting for the player...');
        message.setAttribute('role', 'status');
        message.id = 'expanded-playback-status';
        const blur = button('Off', () => operate('blur'));
        blur.setAttribute('aria-label', 'Ambient Blur: Off');
        blur.setAttribute('aria-pressed', 'false');
        const crop = button('Detect Black Bars', () => operate('detect'));
        const shader = element('select');
        shader.id = 'expanded-playback-upscaling';
        const shaderLabel = element('label', 'Upscaling');
        shaderLabel.htmlFor = shader.id;
        const selectWrap = element('div');
        selectWrap.className = 'expanded-playback-select';
        selectWrap.append(shader);
        shader.append(...presetNames.map((name, index) => new Option(name, index)), new Option('Custom shaders', '-1'));
        shader.lastElementChild.disabled = true;
        shader.addEventListener('change', () => operate(shader.value === '0' ? 'clear' : 'shader-' + shader.value));
        const fallback = element('textarea');
        fallback.readOnly = true;
        fallback.hidden = true;
        fallback.rows = 3;
        fallback.setAttribute('aria-label', 'Playback report text');
        fallback.setAttribute('aria-describedby', message.id);
        let report;
        let playerMessage = message.textContent, feedback = '';
        const renderMessage = () => {
            const content = feedback || playerMessage;
            if (message.textContent !== content) message.textContent = content;
        };
        const copy = button('Copy playback report', async () => {
            if (!report) return;
            const output = reportText(report);
            try {
                await navigator.clipboard.writeText(output);
                feedback = 'Playback report copied.';
                fallback.hidden = true;
            } catch {
                fallback.value = output;
                fallback.hidden = false;
                fallback.focus();
                fallback.select();
                feedback = 'Press Ctrl+C to copy the selected report.';
            }
            renderMessage();
        });
        const show = status => {
            blur.disabled = shader.disabled = copy.disabled = !status.ready;
            crop.disabled = !status.ready || status.crop === 'detecting';
            if (status.ready) {
                const blurLabel = status.blur ? 'On' : 'Off';
                if (blur.textContent !== blurLabel) {
                    blur.textContent = blurLabel;
                    blur.setAttribute('aria-label', 'Ambient Blur: ' + blurLabel);
                    blur.setAttribute('aria-pressed', String(status.blur));
                }
                const cropLabel = status.crop === 'locked' ? 'Restore Frame' :
                    status.crop === 'detecting' ? 'Detecting Black Bars...' : 'Detect Black Bars';
                if (crop.textContent !== cropLabel) crop.textContent = cropLabel;
                const shaderValue = String(status.shader);
                if (shader.value !== shaderValue) shader.value = shaderValue;
            }
            playerMessage = status.error || (status.ready ? status.cropMessage || '' : 'Play a video to use these tools.');
            renderMessage();
            report = status.report;
        };
        const operate = action => {
            feedback = '';
            fallback.hidden = true;
            renderMessage();
            send(playerCommand, action);
            refresh();
        };
        const refresh = () => send(playerCommand, 'status');
        blur.disabled = crop.disabled = shader.disabled = copy.disabled = true;
        const fields = element('div');
        fields.className = 'expanded-playback-fields';
        fields.append(
            field(element('span', 'Ambient blur'), blur),
            field(element('span', 'Black bars'), crop),
            field(shaderLabel, selectWrap)
        );
        const messages = element('div');
        messages.className = 'expanded-playback-messages';
        messages.append(message, fallback);
        const footer = element('div');
        footer.className = 'expanded-playback-footer';
        const done = button('Done', () => popup.close());
        done.className = 'expanded-playback-done';
        footer.append(copy, done);
        popup.append(title, fields, messages, footer);
        // A modal is drawn above the player but still inherits its theme.
        (playbackButton?.closest('[class*="player-container-"]') ?? document.body).append(popup);
        popup.showModal();
        const timer = setInterval(refresh, 750);
        popup.dispose = () => {
            clearInterval(timer);
            if (popup.open && popup.isConnected) popup.close();
            popup.remove();
            if (playbackDialog === popup) playbackDialog = undefined;
        };
        popup.addEventListener('close', popup.dispose, {once: true});
        popup.showStatus = show;
        playbackDialog = popup;
        refresh();
    }

    bridge.addEventListener('message', event => {
        let response = event.data;
        if (typeof response === 'string') {
            try { response = JSON.parse(response); } catch { return; }
        }
        if (!Array.isArray(response?.args)) return;
        const [name, payload] = response.args;
        if (!payload) return;
        if (name === updateCommand) {
            const receive = pending.get(payload.requestId);
            pending.delete(payload.requestId);
            receive?.(payload);
        } else if (name === 'expanded-playback-status') playbackDialog?.showStatus(payload);
    });

    const activeHelp = () => /^#\/settings\/help\/?(?:\?|$)/.test(location.hash);
    const activePlayer = () => /^#\/player(?:[/?]|$)/.test(location.hash);
    function mount() {
        mountQueued = false;
        if (activeHelp()) {
            const pane = document.querySelector('[class*="settings-content-"] [class*="page-container-"]');
            if (pane) {
                updatePanel ??= createUpdates();
                const page = pane.querySelector(':scope > [class*="page-"]') ?? pane;
                const heading = page.querySelector(':scope > [class*="head-"]');
                if (heading) {
                    if (heading.nextElementSibling !== updatePanel) heading.after(updatePanel);
                } else if (page.firstElementChild !== updatePanel) page.prepend(updatePanel);
            }
        } else updatePanel?.remove();
        const inPlayer = activePlayer();
        if (playbackDialog && (!inPlayer || !playbackDialog.isConnected)) playbackDialog.dispose();
        if (inPlayer) {
            // Attach to the controls layer, not the clipped row that holds the native buttons.
            const bar = document.querySelector('[class*="player-container-"] [class*="control-bar-container-"]');
            if (bar && playbackButton?.parentElement !== bar) {
                if (!playbackButton) {
                    playbackButton = button('Playback Tools', showPlayback);
                    playbackButton.className = 'expanded-tools expanded-playback-button';
                    playbackButton.setAttribute('aria-haspopup', 'dialog');
                }
                bar.append(playbackButton);
            }
        } else {
            playbackButton?.remove();
        }
    }

    const queueMount = () => {
        if (!mountQueued) {
            mountQueued = true;
            requestAnimationFrame(mount);
        }
    };
    function routeChanged() {
        observer ??= new MutationObserver(() => {
            if (activeHelp() || activePlayer() || updatePanel?.isConnected ||
                playbackButton?.isConnected || playbackDialog?.open) queueMount();
        });
        observer.disconnect();
        // Older WebViews can detect in-app route changes from the rendered content.
        if (!navigation || activeHelp() || activePlayer())
            observer.observe(document.body, {childList: true, subtree: true});
        queueMount();
    }

    function start() {
        const style = element('style');
        style.textContent = `
            .expanded-tools {
                --expanded-foreground: var(--foreground-color-primary, #f4f3fa);
                --expanded-muted: var(--foreground-color-secondary, #cac5d0);
                --expanded-surface: var(--modal-background-color, #22232c);
                /* Match the seek bar's theme accent; the brand color can stay purple. */
                --expanded-accent: var(--accent-background-color, var(--accent-color, #7b5bf5));
                --expanded-accent-text: var(--accent-foreground-color, white);
                --expanded-line: color-mix(in srgb, var(--expanded-foreground) 18%, transparent);
                --expanded-field: color-mix(in srgb, var(--expanded-foreground) 8%, var(--expanded-surface));
                color: var(--expanded-foreground);
                font: inherit;
            }
            .expanded-tools [hidden] { display: none !important; }
            .expanded-tools h2 { font: inherit; font-weight: 600; margin: 0 0 .75rem; }
            .expanded-tools p { font-size: .9rem; margin: .6rem 0 0; }
            .expanded-tools p:empty { display: none; }
            .expanded-update-panel {
                background: var(--surface-background-color, #22232c);
                border-radius: 1rem;
                padding: 1rem;
            }
            .expanded-tools-row { display: flex; flex-wrap: wrap; gap: .65rem; align-items: center; }
            .expanded-tools button, .expanded-tools select, button.expanded-playback-button {
                background: var(--expanded-surface);
                background: var(--expanded-field);
                color: inherit;
                border: 1px solid transparent;
                border-color: var(--expanded-line);
                border-radius: .65rem;
                padding: .48rem .75rem;
                cursor: pointer;
                font: inherit;
                font-size: .88rem;
            }
            .expanded-tools select { max-inline-size: 100%; }
            .expanded-tools option { color: var(--expanded-foreground); background: var(--expanded-surface); }
            .expanded-tools button:hover:not(:disabled), button.expanded-playback-button:hover {
                border-color: var(--expanded-accent);
                background: color-mix(in srgb, var(--expanded-accent) 20%, var(--expanded-field));
            }
            .expanded-tools :is(button, select, textarea):focus-visible, button.expanded-playback-button:focus-visible {
                outline: 2px solid var(--expanded-accent);
                outline-offset: 2px;
            }
            .expanded-tools button:disabled, .expanded-tools select:disabled { opacity: .55; cursor: default; }
            button.expanded-playback-button {
                position: absolute;
                inset-inline-start: clamp(.75rem, 2.2vw, 2rem);
                inset-block-end: calc(100% + .4rem);
                white-space: nowrap;
                background: var(--expanded-surface);
                background: color-mix(in srgb, var(--expanded-surface) 91%, transparent);
                color: var(--expanded-foreground);
                border-radius: 100vw;
                padding-inline: .95rem;
            }
            .expanded-playback-dialog {
                box-sizing: border-box;
                inline-size: min(32rem, calc(100vw - 1.5rem));
                max-block-size: calc(100dvh - 1.5rem);
                margin: auto;
                padding: clamp(.85rem, 3vw, 1.35rem);
                overflow: auto;
                border: 1px solid transparent;
                border-color: var(--expanded-line);
                border-radius: 1.25rem;
                background: var(--expanded-surface);
                background: color-mix(in srgb, var(--expanded-surface) 88%, transparent);
                backdrop-filter: blur(10px);
                box-shadow: 0 1.25rem 3.5rem #0005;
            }
            .expanded-playback-dialog::backdrop { background: var(--modal-backdrop-color, #0006); }
            .expanded-playback-dialog h2 { font-size: 1.2rem; margin: 0 0 1rem; }
            .expanded-playback-fields { display: grid; gap: .5rem; }
            .expanded-playback-field {
                display: grid;
                grid-template-columns: minmax(0, 1fr) minmax(0, 1.55fr);
                gap: .55rem .9rem;
                align-items: center;
                padding: .45rem .6rem;
                border-radius: .75rem;
                background: var(--surface-background-color, #ffffff10);
                font-size: .9rem;
            }
            .expanded-playback-field :is(button, select) {
                box-sizing: border-box;
                inline-size: 100%;
                min-inline-size: 0;
                block-size: 2.55rem;
            }
            .expanded-playback-field button[aria-pressed="true"] {
                border-color: var(--expanded-accent);
                background: color-mix(in srgb, var(--expanded-accent) 24%, var(--expanded-field));
            }
            .expanded-playback-select { position: relative; min-inline-size: 0; }
            .expanded-playback-select select { appearance: none; padding-inline-end: 2rem; }
            .expanded-playback-select::after {
                content: '';
                position: absolute;
                inset-inline-end: .85rem;
                inset-block-start: 50%;
                width: .42rem;
                height: .42rem;
                border: solid currentColor;
                border-width: 0 1.5px 1.5px 0;
                transform: translateY(-70%) rotate(45deg);
                pointer-events: none;
            }
            .expanded-playback-messages {
                block-size: 2.7rem;
                overflow: auto;
                margin: .5rem 0 .35rem;
                padding-inline: .25rem;
            }
            .expanded-playback-messages p {
                color: var(--expanded-muted);
                margin: .2rem 0;
                font-size: .82rem;
                line-height: 1.35;
            }
            .expanded-playback-messages textarea {
                box-sizing: border-box;
                inline-size: 100%;
                margin-block: .25rem;
                padding: .4rem;
                color: inherit;
                background: var(--expanded-surface);
                border: 1px solid var(--expanded-accent);
                border-radius: .5rem;
                resize: none;
            }
            .expanded-playback-footer {
                display: flex;
                flex-wrap: wrap;
                gap: .55rem;
                justify-content: space-between;
            }
            .expanded-playback-footer button { min-block-size: 2.55rem; }
            .expanded-playback-footer .expanded-playback-done {
                background: var(--expanded-accent);
                color: var(--expanded-accent-text);
                padding-inline: 1.2rem;
            }
            .expanded-playback-footer .expanded-playback-done:hover {
                background: color-mix(in srgb, var(--expanded-accent) 90%, var(--expanded-surface));
            }
            @media (max-width: 440px) {
                .expanded-playback-field { grid-template-columns: minmax(0, 1fr); }
            }
        `;
        document.head.append(style);
        window.addEventListener('hashchange', routeChanged);
        // Stremio's own links update browser history without dispatching hashchange.
        navigation?.addEventListener('currententrychange', routeChanged);
        routeChanged();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {once: true});
    else start();
})();
