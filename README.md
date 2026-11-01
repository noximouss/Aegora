# Aegora

> **Stable release:** Aegora 0.13.0.

Aegora is a desktop browser built with Electron and Chromium. It adds native browser tabs, privacy controls, site permissions, downloads, session restore, page search, and a local password vault.

## What is new in 0.13.0

- Tab groups with colors, collapse/expand, drag-and-drop, and session restore.
- Quick Panel with `Ctrl + Shift + Space` for tabs, bookmarks, and recently closed pages.
- A Performance page with an on-demand snapshot of this window’s Chromium process memory and CPU usage.
- Browser profiles with separate cookies, bookmarks, history, settings, site permissions, and encrypted password vaults. The existing Personal profile keeps the current browser data; new profiles open in their own window.
- The Profiles page has distinct profile artwork and can permanently remove a closed secondary profile, including its local site data and password vault. The Personal profile is protected; close all windows using a profile before removing it.
- Active websites stay visible under Aegora panels; pointer, scroll, and keyboard input continue to reach the page when no panel is open.
- Mouse-wheel and trackpad scrolling are forwarded to the visible website while the pointer is over its page area.
- The browser loading indicator now sweeps across a subtle glass-aligned track with reduced-motion support.
- An Extensions manager can load compatible unpacked Chrome extensions, review requested permissions, and enable, disable, or remove them per browser profile. Electron supports only a subset of Chrome extension APIs; Chrome Web Store pages and `.crx` packages are not installable.
- Aegora-styled live search suggestions for the address bar and new-tab search, with local history/bookmark matches, keyboard navigation, a privacy toggle, and no remote suggestions in private windows.
- Windows Web Installer with background update checks/downloads and a restart-to-install prompt. Stable and Alpha releases use separate update channels.
- Session restore is on by default. Existing profiles migrate to the default-on setting once, and you can still turn it off under Settings → Tabs.

## Run from source

1. Install Node.js 20 or newer.
2. In the project directory, run `npm install`.
3. Run `npm start`.

## Build

Run `npm run build:installer` to create the Windows x64 Web Installer. Pushing a version tag such as `v0.13.1` starts the GitHub Actions release workflow and publishes the installer, app package, and update metadata to GitHub Releases. See [docs/WEB-INSTALLER.md](docs/WEB-INSTALLER.md) for setup and release steps. The portable ZIP remains a separate legacy build and does not self-update.

## Features

- Chromium tabs, address bar, search providers, back/forward and reload.
- Per-profile extension management for compatible unpacked Chrome extension folders. Review requested permissions before installation; support depends on Electron’s available extension APIs.
- Hardened Chromium page isolation (sandbox, context isolation, no Node integration, active web security, and blocked insecure mixed content).
- Aegora Shield uses EasyList and EasyPrivacy network and cosmetic filters, with bundled offline rules, daily automatic refresh, persistent block statistics, and site exceptions for compatibility. When enabled, it also sends Do Not Track and Global Privacy Control signals.
- Site permission prompts for sensitive capabilities; grants explicitly remembered for a site persist across normal browser restarts. Unremembered grants last only for the current app session, and private windows keep permissions temporary.
- Privacy controls reduce exposure but do not provide complete phishing, malware, or tracking protection. Some ads served by the same origin as site content may remain visible.
- Bookmarks, history, downloads, recently closed tabs and session restore. Aegora Spaces saves and reopens named tab sets.
- Right-click tab actions, drag to reorder, pin, duplicate and close other tabs.
- Find text on a page with match counts; keyboard shortcuts include Ctrl+F, Ctrl+Tab, Ctrl+Shift+T, Ctrl+1…9 and F11.
- Aegora Vault: encrypted local password storage, a cryptographically random password generator, copy-to-clipboard and user-triggered autofill.
- Aegora Sync: password-encrypted transfer packages for bookmarks, quick links, saved Spaces, and appearance preferences. Sync is file-based; it does not use a cloud account. Passwords, history, and open sessions remain local.
- Site permission prompts, data clearing, private windows and optional blocking of a small set of known trackers.
- Interface translations in English, Russian, French, Spanish, Chinese, and Arabic, plus theme, accent, wallpaper, and layout settings.
- First-run setup for language, appearance, search provider, and Shield preferences; upgrades keep existing profiles and skip setup.
- Expanded About page with app, Chromium, Electron, and system details.

## Password vault and privacy

Vault entries are encrypted with Electron `safeStorage` and stored in the current Windows user's Aegora profile using the Windows DPAPI. The vault refuses to save when a secure OS-backed store is unavailable. On Windows, the encryption protects the vault from other Windows accounts, but not from malicious software already running as the same user. There is no cloud sync or master-password recovery. Keep the Windows account and device protected.

Autofill is manual, requires an exact origin match, and is limited to HTTPS sites (plus localhost). Aegora does not submit the login form automatically. Copied vault values are cleared from the clipboard after 30 seconds if the clipboard still contains the copied value.

## Current limits

- Extension compatibility is partial: only unpacked folders can be loaded, some Chrome APIs may be unavailable, and extensions are not supported in private windows. Chrome Web Store installation and `.crx` packages are not available.
- No cloud account sync, phishing or malware reputation service, or comprehensive ad/tracker blocking. YouTube and other first-party or server-side ads may bypass list filters.
- Passwords are not synchronized between devices and are not included when sharing the portable app.
- Browser history and profile data are stored locally in the Aegora user profile. Private windows use an isolated temporary session.
- Profiles separate browser data for convenience, but they use the same Windows account and are not a security boundary against software running as that user.
- Aegora does not bypass CAPTCHA or a site's bot checks.

- Animated first-run welcome and setup with a shared Aegora mark transition into the browser.

- First-run setup uses lightweight logo morphs and keeps the main page hidden until the welcome animation finishes.

- Diagnostics copy version and aggregate counts without the current website address or title.

## Third-party notices

Aegora application code is licensed under MIT. EasyList and EasyPrivacy filter data is distributed under GNU GPL version 3 or later and attributed to the EasyList authors. See [third-party notices](THIRD-PARTY-NOTICES.md) and the included license text.
