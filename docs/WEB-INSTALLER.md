# Aegora Web Installer and updates

Windows releases use the NSIS Web Installer. The small setup EXE downloads the matching Aegora package from the assets of the public GitHub release. The installed browser checks GitHub after startup and every six hours, downloads available updates in the background, and offers a restart button when installation is ready.

The installer is per-user. It keeps the Aegora profile in the same Windows user data folder; uninstalling the app does not delete that profile.

## Releasing a version

1. Update `version` in `package.json` and `package-lock.json`.
2. Commit and push the source, including `.github/workflows/release.yml`, to `noximouss/Aegora`.
3. Create and push a matching tag, for example `v0.13.1` for stable or `v0.13.1-alpha.1` for an alpha build.
4. GitHub Actions builds the Windows x64 Web Installer and publishes the release assets. Stable versions go to the Stable channel; versions containing `-alpha.` go to the Alpha channel.

The workflow uses the built-in GitHub Actions token. It checks that the pushed tag exactly matches the app version before building. It publishes three matching assets: the small `Aegora-Web-Setup-<version>.exe`, the `aegora-<version>-x64.nsis.7z` app package, and `latest.yml` (or `alpha.yml` for alpha builds). If uploading assets manually, upload those files individually to the same public GitHub Release; the setup and updater need the package and metadata beside them. The repository must contain Aegora's source files and this workflow before tag-triggered builds can run.

Do not replace release assets or update metadata files after publishing. They are a matched set and contain checksums. Build and publish a new version if an asset needs to change.

## Update integrity and current signing limit

`electron-updater` checks the downloaded installer/package against its SHA-512 value in the update metadata and downloads it from GitHub over HTTPS. The current released `electron-builder` 26.x version does not support signed update manifests, so the metadata itself is not cryptographically signed. Protect the GitHub account and limit who can edit Releases. A later electron-builder release can add signed manifests after it is available and verified with the app's updater version.

Aegora does not have a Windows Authenticode certificate. Updates use the package checksum instead of publisher-signature verification, and Windows may show an unknown-publisher/SmartScreen warning when users run the installer.

## What users download

Use the small `Aegora-Web-Setup-<version>.exe` for first installation. The release also contains a `.nsis.7z` app package and update metadata; the installer and Aegora use those files automatically. The portable ZIP remains a separate legacy option and cannot self-update. Users of the old portable build need to install the Web Installer once; their browser data stays in the same Windows user profile.
