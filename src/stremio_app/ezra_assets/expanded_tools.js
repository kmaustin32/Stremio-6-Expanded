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

    function showPlayback() {
        if (playbackDialog?.open) return;
        const popup = element('dialog');
        popup.className = 'expanded-tools expanded-playback-dialog';
        popup.setAttribute('aria-label', 'Playback Tools');
        const title = element('h2', 'Playback Tools');
        const message = element('p', 'Waiting for the player...');
        message.setAttribute('role', 'status');
        const feedback = element('p');
        feedback.setAttribute('role', 'status');
        const blur = button('Ambient Blur', () => operate('blur'));
        const crop = button('Detect Black Bars', () => operate('detect'));
        const shader = element('select');
        const shaderLabel = element('label', 'Upscaling ');
        shaderLabel.append(shader);
        shader.append(...presetNames.map((name, index) => new Option(name, index)), new Option('Custom shaders', '-1'));
        shader.lastElementChild.disabled = true;
        shader.addEventListener('change', () => operate(shader.value === '0' ? 'clear' : 'shader-' + shader.value));
        const fallback = element('textarea');
        fallback.readOnly = true;
        fallback.hidden = true;
        fallback.rows = 6;
        fallback.setAttribute('aria-label', 'Playback report text');
        let report;
        const copy = button('Copy playback report', async () => {
            if (!report) return;
            const output = reportText(report);
            try {
                await navigator.clipboard.writeText(output);
                feedback.textContent = 'Playback report copied.';
                fallback.hidden = true;
            } catch {
                fallback.value = output;
                fallback.hidden = false;
                fallback.focus();
                fallback.select();
                feedback.textContent = 'Press Ctrl+C to copy the selected report.';
            }
        });
        const show = status => {
            blur.disabled = crop.disabled = shader.disabled = copy.disabled = !status.ready;
            if (status.ready) {
                blur.textContent = 'Ambient Blur: ' + (status.blur ? 'On' : 'Off');
                blur.setAttribute('aria-pressed', String(status.blur));
                crop.textContent = status.crop === 'locked' ? 'Restore Frame' :
                    status.crop === 'detecting' ? 'Detecting Black Bars...' : 'Detect Black Bars';
                crop.disabled = status.crop === 'detecting';
                shader.value = String(status.shader);
            }
            message.textContent = status.error || (status.ready ? status.cropMessage || '' : 'Play a video to use these tools.');
            report = status.report;
        };
        const operate = action => {
            send(playerCommand, action);
            refresh();
        };
        const refresh = () => send(playerCommand, 'status');
        blur.disabled = crop.disabled = shader.disabled = copy.disabled = true;
        const row = element('div');
        row.className = 'expanded-tools-row';
        row.append(blur, crop, shaderLabel);
        const footer = element('div');
        footer.className = 'expanded-tools-row';
        footer.append(copy, button('Done', () => popup.close()));
        popup.append(title, row, message, footer, feedback, fallback);
        document.body.append(popup);
        popup.showModal();
        const timer = setInterval(refresh, 750);
        popup.addEventListener('close', () => {
            clearInterval(timer);
            popup.remove();
            if (playbackDialog === popup) playbackDialog = undefined;
        });
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

    const activeSettings = () => /^#\/settings(?:[/?]|$)/.test(location.hash);
    const activePlayer = () => /^#\/player(?:[/?]|$)/.test(location.hash);
    function mount() {
        mountQueued = false;
        if (activeSettings()) {
            const pane = document.querySelector('[class*="settings-content-"] [class*="page-container-"]');
            if (pane && (!updatePanel || pane.firstElementChild !== updatePanel)) {
                updatePanel ??= createUpdates();
                pane.prepend(updatePanel);
            }
        } else updatePanel?.remove();
        if (activePlayer()) {
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
            if (playbackDialog?.open) playbackDialog.close();
        }
    }

    const queueMount = () => {
        if (!mountQueued) {
            mountQueued = true;
            requestAnimationFrame(mount);
        }
    };
    function routeChanged() {
        observer ??= new MutationObserver(queueMount);
        observer.disconnect();
        if (activeSettings() || activePlayer()) observer.observe(document.body, {childList: true, subtree: true});
        queueMount();
    }

    function start() {
        const style = element('style');
        style.textContent = `
            .expanded-tools { color: var(--primary-foreground-color, #f4f3fa); font: inherit; }
            .expanded-tools [hidden] { display: none !important; }
            .expanded-tools h2 { font: inherit; font-weight: 600; margin: 0 0 .75rem; }
            .expanded-tools p { font-size: .9rem; margin: .6rem 0 0; }
            .expanded-tools p:empty { display: none; }
            .expanded-update-panel { background: var(--overlay-color, #22232c);
                border-radius: .7rem; padding: .9rem; margin: 1rem 0; }
            .expanded-tools-row { display: flex; flex-wrap: wrap; gap: .65rem; align-items: center; }
            .expanded-tools button, .expanded-tools select, button.expanded-playback-button {
                background: var(--secondary-background-color, #272633); color: inherit;
                border: 1px solid var(--primary-accent-color, #8585ce); border-radius: .5rem;
                padding: .4rem .65rem; cursor: pointer; font: inherit; font-size: .88rem; }
            .expanded-tools select { color-scheme: dark light; max-width: 100%; }
            .expanded-tools button:hover:not(:disabled), button.expanded-playback-button:hover {
                background: var(--primary-accent-color, #7272c2); color: white; }
            .expanded-tools button:disabled, .expanded-tools select:disabled { opacity: .55; cursor: default; }
            button.expanded-playback-button {
                position: absolute; inset-inline-start: clamp(.75rem, 2.2vw, 2rem);
                inset-block-end: calc(100% + .4rem); white-space: nowrap;
            }
            .expanded-playback-dialog { background: var(--secondary-background-color, #22232c);
                border: 1px solid var(--primary-accent-color, #8585ce); border-radius: .8rem;
                width: min(28rem, calc(100vw - 2rem)); padding: 1.15rem; margin: auto;
                max-height: calc(100vh - 2rem); overflow: auto; }
            .expanded-playback-dialog::backdrop { background: #0006; }
            .expanded-playback-dialog > .expanded-tools-row + p + .expanded-tools-row { margin-top: .8rem; }
            .expanded-playback-dialog textarea { width: 100%; margin-top: .6rem; color: inherit;
                background: var(--primary-background-color, #1a1a26); }
        `;
        document.head.append(style);
        window.addEventListener('hashchange', routeChanged);
        routeChanged();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {once: true});
    else start();
})();
