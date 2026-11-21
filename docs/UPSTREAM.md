# Keeping official updates compatible with the fork

The current official baseline is `Stremio/stremio-shell-ng` main at
`e148e2a6801b4af3afd143262f2280a866da7c87` (integrated on 2026-11-20).
It adds the `sub-bold` and `force-media-title` properties. The fork's release
version remains separate from the official release tags.

## Integration workflow

Start an integration branch from the fork's current `main`, fetch official
`upstream/main` without importing its tags, and merge it normally. Preserve both
histories. Review every overlap with the fork's code instead of resetting the
fork to upstream or using a blanket conflict strategy.

Keep Library integration in `ezra_library.rs` and `ezra_assets/fork-lists.js` /
`library_adapter.js`, and playback controls in `ezra_playback.rs` and its assets.
Keep artwork compatibility in `ezra_assets/artwork.js`. Library and artwork
factory wrappers preserve the original factory's `toString` contract so they can
compose without hiding component signatures from each other.
Review changes to the native message routing, player initialization, app profile,
installer identity and packaging as well as direct edits to those modules.

## Checks before merging or releasing

- Run Windows formatting, clippy and Rust tests, including the player message
  contract and server lifecycle tests.
- Run `node --test tests/ezra-core.test.cjs`. This checks plain/memoized poster
  components, list-loading recovery, saved membership and playback shortcuts.
- Run the hosted Library check below. It checks actual current Stremio components
  using dummy Library data and an in-memory bridge in a fresh browser profile.
- Run `node tests/hosted-artwork.cjs` with the same browser tools. It renders the
  actual Home, poster, episode-picker, player episode-drawer and next-video
  components with synthetic images. It checks missing URLs, HTTP failures,
  fallback ordering, placeholders, watched-state blur and episode changes.
- Run `python tests/black_bar_detection.py --dll libmpv-2.dll --ffmpeg bin/ffmpeg.exe`.
  This renders actual video and checks blur, FSR, crop resizing, no-bar safety,
  restoration and per-video reset. Use `--hardware` on a machine with a supported
  D3D11 GPU to additionally test GPU-processing toggles and 8/10-bit output.
- For a release, complete installer and portable startup/payload checks and verify
  the published package checksums. Keep fork tags under `custom-v<version>`.

The continuous-integration and fork-release workflows run these checks. A failure
needs investigation; do not remove a failing compatibility check simply to publish.

## Hosted Library check

Use Node 20+ and Microsoft Edge on Windows. From the repository root:

```powershell
npm install --prefix .ci-tools --no-save --ignore-scripts --no-audit --no-fund playwright@1.62.1
$env:NODE_PATH = "$pwd/.ci-tools/node_modules"
node tests/hosted-library.cjs
node tests/hosted-artwork.cjs
```

`STREMIO_TEST_BROWSER` can select another installed Chromium browser. The test
does not use a real account, user profile, private stream, or streaming provider.
Its Library saves stay in memory. It requires access to the public Stremio WebUI;
distinguish a service outage from an interface-contract change when it fails.

The web interface is hosted separately and can change after a desktop release.
Tests reduce regression risk; they cannot guarantee every future remote change
will be compatible. The runtime compatibility notice should remain available when
the Library adapter cannot recognize the interface, preserving saved lists.
