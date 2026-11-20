# Stremio6-Custom

A Windows fork of [Stremio's official Rust shell](https://github.com/Stremio/stremio-shell-ng), using WebView2 and mpv. It brings Ezra's Library lists and playback shortcuts to the official Stremio interface.

## Download

Get the Windows x64 installer or portable ZIP from the [latest stable release](https://github.com/kmaustin32/Stremio6-Custom/releases/latest). To use the portable build, extract the ZIP and run `Stremio6-Custom.exe`. The installer uses a separate app profile and Start menu entry and installs WebView2 if needed.

## Library lists and sorting

- Create and manage lists directly from the Library toolbar. Use the **All**, **Anime**, **Live Action**, and **Most Watched** chips or select a custom list from the dropdown.
- Sort or filter within the selected list. The toolbar supports **A–Z**, **Z–A**, **Last Watched**, **Watched**, and **Not Watched**, alongside the movie and series filter.
- Use **Add to list** in a title's three-dot menu. **Ctrl+click** selects titles for a bulk edit, and a title can belong to multiple custom lists.
- Anime and Live Action are filled automatically. Manual moves are saved, and custom lists can be shown on Home. Lists are saved on this computer for each Stremio account.

## Playback shortcuts

| Shortcut | Action |
| --- | --- |
| **Ctrl+Shift+C** | Detect baked-in black bars during playback and keep the confirmed crop for the current video. Press again to restore the full frame. A video without confirmed bars keeps its original framing. |
| **Ctrl+B** | Toggle ambient blur in the space around the video. You can use it after detecting baked-in bars. |
| **Ctrl+1–6** | Select an Anime4K HQ shader preset. |
| **Ctrl+7** | Select FSR upscaling. |
| **Ctrl+8** | Clear the active shaders. |

Black-bar detection measures the frames after video processing, including GPU-resized output. It preserves the selected decoder and existing processing filters. Detection leaves blur under your control; use **Ctrl+B** after cropping to fill the newly exposed space.

## Stremio6-Custom releases and upstream updates

Stable fork tags use `custom-v<version>` so official Stremio tags can coexist with them. Start from this fork's `main` when creating an integration branch to bring in an official shell update. Add the upstream remote once per clone.

```sh
git remote add upstream https://github.com/Stremio/stremio-shell-ng.git
git fetch upstream --no-tags main
git switch main
git pull --ff-only origin main
git switch -c codex/update-stremio-shell
git merge upstream/main
```

Run Windows CI and check the Library toolbar, watched filters, poster menu, and bulk selection with a signed-in library before merging the integration branch into `main`. Check blur, crop, and shader shortcuts during playback. The hosted Stremio Web interface updates separately from the shell. If its Library structure changes, check that the custom controls appear and saved lists still load.

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
