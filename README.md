# Stremio 6 Expanded

A Windows fork of [Stremio's official Rust shell](https://github.com/Stremio/stremio-shell-ng), using WebView2 and mpv. It brings Ezra's Library lists and playback shortcuts to the official Stremio interface.

## Download

Get the Windows x64 installer or portable ZIP from the [releases page](https://github.com/kmaustin32/Stremio-6-Expanded/releases). New builds use `Stremio 6 Expanded.exe` and a **Stremio 6 Expanded** Start menu entry. Existing 5.0.30 downloads retain their original Stremio6-Custom name. The installer installs WebView2 if needed.

**5.0.30** restores the custom poster-menu actions after Stremio's web interface update, preserves detected framing when GPU processing changes video size, and automatically retries temporary errors loading saved lists.

**5.0.32** restores Ezra's episode-specific anime thumbnail fallback. The project is now **Stremio 6 Expanded**. Upgrading preserves existing lists, player settings, streaming-server data and browser profiles. The installer retains compatibility with shortcuts targeting the old executable and replaces the old Start menu entry. Internal storage keys and the original installer identity intentionally stay the same to protect existing data.

## What's new in 5.1.0

- Check for updates from **Settings → Help and about**. Choose the Stable or Beta channel and download a verified installer or portable ZIP.
- Open **Playback Tools** above the seek bar to toggle ambient blur, detect or restore black bars, pick an Anime4K or FSR preset, and copy a playback report. The translucent popup uses the selected theme's accent, keeps its controls in place as settings change, and reopens after the player rebuilds its controls.
- Back up custom Library lists and manual Anime/Live Action choices. Preview the merge before restoring, including into lists that have since been renamed.
- Repeat local builds safely in the same checkout. The checksum file covers the installer and ZIP for the current version. Daily checks now also cover Playback Tools and the updater against the live Stremio interface.

### Check for updates

Go to **Settings → Help and about**. The **Stremio 6 Expanded** card shows the installed version. Choose **Stable** or **Beta**, then select **Check for updates**. Beta includes both preview builds and newer stable releases. New beta installs default to Beta, and the app remembers your channel choice. Expanded checks this fork's GitHub releases and verifies the downloaded package against GitHub's SHA-256 digest. On an installed copy, select **Close app and open installer** after verification. Portable copies download a ZIP and let you open its folder.

## Manual next-episode prompt

**5.0.33** allows the next-episode popup to appear near the end with **Auto Play off**, so you can choose **Watch now** manually. The existing popup-duration setting controls when it appears; **Disabled** still hides it. Auto Play remains off and does not start the next episode automatically. Dismissal, live TV, final episodes and the existing end-of-file navigation are preserved. The next prompt and Skip Outro do not overlap.

## Artwork that keeps working

Home and Library posters, episode details, the player episode panel and the next-episode popup handle missing URLs and failed downloads. Episode previews try artwork for that episode before using the show's poster/background or a placeholder. Ezra's anime fallback translates seasonal numbering into absolute episode numbers when the artwork provider keeps all episodes under season 1: Inuyasha S3E17, for example, uses overall episode 71. Specials are excluded from that offset, and incomplete episode lists are not used to guess a number.

If a view lacks the full episode catalog needed for the conversion, an image failure can trigger a cached public Cinemeta lookup using only the title's IMDb ID. Working images do not trigger that lookup. No account credentials or stream URLs are sent. Unwatched-episode blur stays on every replacement image, watched previews remain clear, and changing episodes selects that episode's own artwork.

## Library lists and sorting

- Create and manage lists directly from the Library toolbar. Use the **All**, **Anime**, **Live Action**, and **Most Watched** chips or select a custom list from the dropdown.
- Sort or filter within the selected list. The toolbar supports **A–Z**, **Z–A**, **Last Watched**, **Watched**, and **Not Watched**, alongside the movie and series filter.
- Use **Add to list** in a title's three-dot menu. **Ctrl+click** selects titles for a bulk edit, and a title can belong to multiple custom lists.
- Anime and Live Action are filled automatically. Manual moves are saved, and custom lists can be shown on Home. Lists are saved on this computer for each Stremio account.
- Temporary errors loading saved lists retry automatically after a short delay.
- Use **Library → Back up lists** to export a JSON file with list membership, Home visibility, and manual Anime/Live Action choices. Keep the file anywhere you like, including a synced Drive folder. On another computer, sign in, choose the file in the same dialog, review the preview, and select **Restore lists**. Restore merges matching lists and keeps conflicting manual classifications from the device you are restoring to. The file covers Expanded lists and does not restore Stremio account data or add titles to the Stremio Library.

## Playback Tools

During playback, move the mouse to show the player controls. Select **Playback Tools** just above the left end of the seek bar for ambient blur, detecting or restoring black-bar crops, and choosing an Anime4K or FSR preset. The button and translucent popup follow the selected Stremio theme, including the seek bar's accent for highlights, focus rings and **Done**. The controls stay in place as selections and status messages change. **Copy playback report** copies a snapshot of the decoder, dropped frames, buffer status, and enabled processing. It excludes stream URLs, filenames, titles, and account details.

**5.1.1 Beta 3** adds a more visible range for **Extra sharpening** below **Upscaling** and keeps slider drags from triggering the player's hold-to-speed gesture. The FidelityFX CAS slider starts at **0%** each time the app opens and works alongside the selected upscaler with GPU Next. Set **Upscaling → Off** to keep sharpening on its own, or press **Ctrl+8** to clear all shaders. The Playback Tools button clears its fill on hover like Skip Outro, with the theme accent outlining the button.

## Playback shortcuts

| Shortcut | Action |
| --- | --- |
| **Ctrl+Shift+X** | Open Playback Tools during playback, including when the controls are hidden. |
| **Ctrl+Shift+C** | Detect baked-in black bars during playback and keep the confirmed crop for the current video. Press again to restore the full frame. A video without confirmed bars keeps its original framing. |
| **Ctrl+B** | Toggle ambient blur in the space around the video. You can use it after detecting baked-in bars. |
| **Ctrl+1–6** | Select an Anime4K HQ shader preset. |
| **Ctrl+7** | Select FSR upscaling. |
| **Ctrl+8** | Clear the active shaders. |

Black-bar detection measures the frames after video processing, including GPU-resized output. It preserves the selected decoder and existing processing filters. The confirmed framing follows video-size changes when GPU processing is toggled. Detection leaves blur under your control; use **Ctrl+B** after cropping to fill the newly exposed space.

## Stremio 6 Expanded releases and upstream updates

On Windows with the Rust/MSVC build tools and Inno Setup installed, `./build.ps1`
builds this fork's installer and portable ZIP in `preview-output`, with SHA-256
checksums. It does not install or uninstall anything on your computer. GitHub's
manual build workflow additionally tests clean installation, upgrades from the
previous product name, startup and uninstall in an isolated runner account, and
provides the tested files as a downloadable artifact without publishing a release.

Stable fork tags use `custom-v<version>` so official Stremio tags can coexist with them. Start from this fork's `main` when creating an integration branch to bring in an official shell update. Add the upstream remote once per clone.

Beta tags use `v<version>-custom.<number>` and include the suffix in the app's reported version. GitHub checks the hosted interface daily independently of releases.

```sh
git remote add upstream https://github.com/Stremio/stremio-shell-ng.git
git fetch upstream --no-tags main
git switch main
git pull --ff-only origin main
git switch -c codex/update-stremio-shell
git merge upstream/main
```

Run Windows CI and check the Library toolbar, watched filters, poster menu, and bulk selection with a signed-in library before merging the integration branch into `main`. Check blur, crop, and shader shortcuts during playback. The hosted Stremio Web interface updates separately from the shell. If its Library structure changes, check that the custom controls appear and saved lists still load.

The source includes official upstream changes through [`e148e2a`](https://github.com/Stremio/stremio-shell-ng/commit/e148e2a6801b4af3afd143262f2280a866da7c87), adding support for the `sub-bold` and `force-media-title` player properties.

Windows CI and release builds run real hosted-Library and artwork compatibility tests with dummy data in an isolated browser. They check custom menus, saved lists, missing and broken artwork, alternate images and spoiler blur without using a real account. See [the upstream update checks](docs/UPSTREAM.md) before integrating future updates. These checks cover known regressions; future hosted-interface changes can still require an adapter update.

## Shell architecture

Goals:
* Performance
* Reliability
* Easy to ship

In all three, this architecture excels the [Qt-based shell](https://github.com/Stremio/stremio-shell): it is about 2-5x more efficient depending on the use case, as it allows MPV to render directly in the window through it's optimal video output rather than using libmpv to integrate with Qt.

This is due to Qt having a complex rendering pipeline involving ANGLE and multiple levels of composing and drawing to textures, which inhibits full HW acceleration.

Meanwhile in this setup MPV uses whichever pipeline it considers to be optimal (like the mpv desktop app), which is normally d3d11, allowing full HW acceleration.

For web rendering, we use the native WebView2, which is Chromium based but shipped as a part of Windows 10: therefore we do not need to ship our own "distribution" of Chromium.

Finally, this should be a lot more reliable as it uses a much simpler and more native overall architecture.

## Native ASS subtitles

The WebUI handshake advertises `nativeAssSubtitles=true` after the existing GPU
capability. The player accepts these subtitle commands:

```json
["mpv-command", ["sub-add", "https://example.com/subtitles.ass", "auto", "English", "eng"]]
["mpv-command", ["sub-remove", "7"]]
```

Subtitle loading runs on a dedicated mpv client with one asynchronous command in
flight. `loadfile` and `stop` cancel and drain subtitle work before changing media.
Subtitle commands do not reset video readiness. The WebUI matches `track-list`
titles to the current request before setting `sid`, preventing late loads from
changing the user's selection.

mpv handles fonts embedded in the media or subtitle file and installed system
fonts. Subtitles with separate font URLs stay in the WebUI libass renderer.
