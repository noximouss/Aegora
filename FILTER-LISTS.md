# Aegora Shield filter lists

Aegora Shield bundles compiled snapshots of EasyList and EasyPrivacy so filtering works offline on first launch. It checks the upstream lists after a short startup delay, refreshes at most once per day, and keeps the last working copy if a download fails. You can also request an update in Settings → Privacy.

Sources:

- EasyList: <https://easylist.to/easylist/easylist.txt>
- EasyPrivacy: <https://easylist.to/easylist/easyprivacy.txt>
- Project and authors: <https://easylist.to/>
- Licensing: <https://easylist.to/pages/licence.html>

The EasyList project offers its repository contents under either GNU GPL version 3 or later, or CC BY-SA 3.0 Unported or later. Aegora chooses GNU GPL version 3 or later for the bundled filter data and compiled snapshots. Attribution: “The EasyList authors.” The full GPL text is in licenses/GPL-3.0.txt; see THIRD-PARTY-NOTICES.md for details. The compiled snapshots in build/shield-engine*.bin are generated from those lists and are not a replacement for the upstream sources.

The filtering engine is @ghostery/adblocker-electron (Mozilla Public License 2.0). Its license is included with the installed package under node_modules/@ghostery/adblocker-electron/LICENSE.

Filter rules can block third-party requests and cosmetic page elements. They do not guarantee removal of ads served from the same origin as video content, including some YouTube ad delivery. Site-specific exceptions may improve compatibility but reduce filtering on that site.
