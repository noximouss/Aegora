# Aegora Privacy Policy

Last updated: 1 November 2026

Aegora does not operate an account service, cloud profile service, or analytics backend. The Aegora project does not receive or store your browsing history, bookmarks, cookies, passwords, or profile settings.

## Data stored on your device

Aegora stores browser profile data in the local Windows user profile. This can include browsing history, bookmarks, cookies and site storage, download records, open-session state, settings, site permissions, and extension configuration. These data remain on the device unless you choose to export or otherwise share them.

Aegora Vault encrypts saved credentials using Electron safeStorage, which uses Windows DPAPI on Windows. This protects vault data from other Windows accounts, but not from malicious software already running as your Windows user.

Private windows use a temporary isolated browser session. Files you deliberately download remain in the folder you selected. Uninstalling Aegora does not automatically remove the browser profile.

## Network requests

When you visit a website, that site receives the requests and connection information needed to serve the pages, including your IP address and any cookies or site data for that site.

If search suggestions are enabled, Aegora sends the text you type in the address bar to the selected search provider to retrieve suggestions. You can disable remote suggestions in Settings. Private windows do not send remote suggestion requests.

Aegora checks GitHub Releases for application updates and downloads EasyList/EasyPrivacy filter updates from easylist.to. Those services receive ordinary connection information such as your IP address and request metadata. Aegora does not include your browser profile, browsing history, or saved passwords in these update requests.

Compatible extensions may process website data according to their own code and the permissions you grant. Install extensions only from sources you trust and review their requested permissions.

## User-initiated sharing

Aegora Sync creates an encrypted file on your device for you to save or share. It does not upload that file to an Aegora cloud service. Passwords, history, and open sessions are not included. Diagnostics are copied only when you request them and contain the app version and aggregate counts, not the current website address or title.

## Your choices

You can clear local browsing data, turn off remote search suggestions, disable extensions, or remove a browser profile from Aegora. Third-party websites and search providers apply their own privacy policies to requests you send them.
