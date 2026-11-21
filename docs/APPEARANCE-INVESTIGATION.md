# Account-independent appearance controls (investigation only)

Checked the public Stremio Web interface on 2026-11-21. No appearance or account
entitlement changes are part of this update.

- The native shell does not contain these settings; it displays Stremio's hosted
  web interface. That interface's Settings page checks `profile.hasPremium`
  before showing the theme selector and navigation-style settings.
- The runtime also checks `hasPremium` when applying the minimalistic navigation
  style, so revealing the settings row alone would not make it work.
- Theme palettes and their CSS-variable renderer already execute locally in the
  page. Its theme module exposes `list()` and `set()`, and includes Blueberry,
  Lime, Night, Ocean, Paper and Vulcano. Stremio describes themes and minimalistic
  navigation as supporter features in [Tech Update 90](https://blog.stremio.com/stremio-tech-update-90-stremio-desktop-and-stremio-web-update/).

We can implement independent theme and compact/normal presentation controls in
the fork, store their choices locally, and apply them without a paid login. This
would need separate settings and rendering hooks plus checks for normal/free and
supporter accounts, profile changes, restarting, all pages and playback. Keep
these preferences separate from Stremio's synced profile so they are not reset
by account refreshes. Do not fake the account's subscription status: independent
local styling would not grant any service-side benefits. Confirm whether the
desired compact layout means navigation style or content density before building
it; these are different controls.
