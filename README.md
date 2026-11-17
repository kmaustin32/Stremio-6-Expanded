## Stremio shell: new gen

A Windows-only shell using WebView2 and MPV

## Stremio6-Custom releases and upstream updates

Download the Windows installer or portable ZIP from [GitHub Releases](https://github.com/kmaustin32/Stremio6-Custom/releases). Stable fork tags use `custom-v<version>` so official Stremio tags can coexist with them.

Use `codex/ezra-core-stable` as the base for a new integration branch when updating the official Windows shell. Add the upstream remote once per clone, then merge its latest `main` into the integration branch:

```sh
git remote add upstream https://github.com/Stremio/stremio-shell-ng.git
git fetch upstream --no-tags main
git switch codex/ezra-core-stable
git switch -c codex/update-stremio-shell
git merge upstream/main
```

Run Windows CI and check the Library toolbar, watched filters, poster menu and bulk selection with a signed-in library before merging the integration branch back. Check the blur, crop and shader shortcuts on actual playback as well. The hosted Stremio Web interface updates separately from the shell. If its Library structure changes, check that the custom controls appear and that saved lists still load before publishing another release.

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
