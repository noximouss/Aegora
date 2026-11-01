const { contextBridge, ipcRenderer: r } = require("electron");
const CH = ["tab", "dl", "key", "newtab", "closeRequested", "permissionRequest", "permissions", "findResult", "profilesChanged", "extensionsChanged", "updateStatus"];
contextBridge.exposeInMainWorld("aegora", {
  show: (id, rect, url) => r.send("show", id, rect, url), navigate: (id, url, force) => r.send("navigate", id, url, !!force),
  hide: () => r.send("hide"), bounds: rect => r.send("bounds", rect), overlay: b => r.send("overlay", !!b), wheel: input => r.send("wheel", input),
  close: id => r.send("close", id), reload: id => r.send("reload", id), print: id => r.send("print", id),
  findInPage: (id, query, options) => r.send("findInPage", id, query, options), stopFindInPage: id => r.send("stopFindInPage", id),
  savePage: id => r.invoke("savePage", id), saveFile: (name, data) => r.invoke("saveFile", name, data),
  dlOpen: p => r.send("dlOpen", p), dlShow: p => r.send("dlShow", p), dlCancel: id => r.send("dlCancel", id),
  performance: () => r.invoke("performanceMetrics"), profiles: () => r.invoke("profilesList"), createProfile: name => r.invoke("profileCreate", name), openProfile: id => r.invoke("profileOpen", id), deleteProfile: id => r.invoke("profileDelete", id), info: () => r.invoke("info"), permissions: () => r.invoke("permissions"), revokePermission: (origin, permission) => r.invoke("revokePermission", origin, permission), clearData: origin => r.invoke("clearData", origin),
  extensions: () => r.invoke("extensionsList"), selectExtension: () => r.invoke("extensionSelect"), installExtension: token => r.invoke("extensionInstall", token), setExtensionEnabled: (id, enabled) => r.invoke("extensionSetEnabled", id, !!enabled), removeExtension: id => r.invoke("extensionRemove", id),
  searchSuggestions: (query, engine, locale) => r.invoke("searchSuggestions", String(query||""), String(engine||""), String(locale||"en")),
  cancelSearchSuggestions: () => r.send("cancelSearchSuggestions"),
  checkForUpdates: () => r.invoke("checkForUpdates"), installUpdate: () => r.send("installUpdate"),
  shieldStatus: () => r.invoke("shieldStatus"), updateShield: () => r.invoke("shieldUpdate"),
  vaultStatus: () => r.invoke("vaultStatus"), vaultList: () => r.invoke("vaultList"), vaultGet: id => r.invoke("vaultGet", id),
  vaultSave: entry => r.invoke("vaultSave", entry), vaultDelete: id => r.invoke("vaultDelete", id), vaultCopy: (id, field) => r.invoke("vaultCopy", id, field), vaultFill: (tabId, id) => r.invoke("vaultFill", tabId, id),
  privateWindow: () => r.send("newPrivate"), openExternal: url => r.send("openExternal", url), confirmClose: accepted => r.send("closeConfirmed", accepted),
  replyPermission: (id, allowed, remember) => r.send("permissionReply", id, allowed, remember),
  tracking: enabled => r.send("setTracking", enabled), setLanguage: language => r.send("setLanguage", language), diagnostics: data => r.invoke("diagnostics", data), ready: () => r.send("appReady"),
  on: (ch, fn) => { if (CH.includes(ch)) r.on(ch, (_e, d) => fn(d)); }
});
