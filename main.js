const { app, BaseWindow, WebContentsView, ipcMain, session, shell, dialog, Menu, clipboard, safeStorage } = require("electron");
const path = require("path");
const fs = require("fs");
const { randomUUID } = require("crypto");
const { ElectronBlocker, fromElectronDetails } = require("@ghostery/adblocker-electron");
const ProfileUtils = require("./renderer/profile-utils");

if (!app.requestSingleInstanceLock()) { app.quit(); return; }

const windows = new Map();
const contentOwners = new Map();
const downloadItems = new Map();
const knownDownloads = new Set();
const pendingPermissions = new Map();
const configuredSessions = new WeakSet();
const shieldCosmeticSessions = new WeakSet();
const rememberedPermissionsByProfile = new Map();
const extensionRegistryCache = new Map();
const extensionErrorsByProfile = new Map();
const extensionLoadPromises = new WeakMap();
const extensionMutationQueues = new Map();
const pendingSearchSuggestions = new Map();
const MAX_PROFILE_EXTENSIONS = 30;
let profileRegistry = [ { ...ProfileUtils.DEFAULT_PROFILE } ];
const deletingProfiles = new Set();
const pendingUrls = [];
const VAULT_MAGIC = Buffer.from("AEGORA-VAULT-1\n", "utf8");
let vaultQueue = Promise.resolve();
let mainState = null;
let downloadId = 0;
let permissionId = 0;
let vaultClipboardValue = null;
let vaultClipboardGeneration = 0;
let shieldBlocker = null, shieldPrivacyBlocker = null, shieldUpdatedAt = null, shieldUpdatePromise = null;
let shieldCosmeticIpcRegistered = false;
const shieldLists = ["https://easylist.to/easylist/easylist.txt", "https://easylist.to/easylist/easyprivacy.txt"];
const shieldStats = { blockedRequests: 0, blockedDomains: new Set(), trackerRequests: 0, trackerDomains: new Set() };
let shieldStatsSaveQueued = false;
let autoUpdater = null, updateCheckPromise = null, lastUpdateCheckAt = 0;
let updateStatus = { status: "idle" };

function profilesFilePath() { return path.join(app.getPath("userData"), "profiles.json"); }
function saveProfileRegistry() {
  try { const file=profilesFilePath(),temp=`${file}.tmp`;fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(temp,JSON.stringify(profileRegistry,null,2));fs.renameSync(temp,file);return true; } catch { return false; }
}
function loadProfileRegistry() {
  try { profileRegistry=ProfileUtils.normalizeProfiles(JSON.parse(fs.readFileSync(profilesFilePath(),"utf8"))); }
  catch { profileRegistry=[{...ProfileUtils.DEFAULT_PROFILE}];saveProfileRegistry(); }
}
function profileDataDirectory(profileId) {
  if(profileId==="default")return app.getPath("userData");
  if(!profileRegistry.some(profile=>profile.id===profileId))return null;
  return path.join(app.getPath("userData"),"Profiles",profileId);
}
function suggestionRequestUrl(engineId,query,locale) {
  const q=encodeURIComponent(query),tag=({ru:"ru-RU",en:"en-US",fr:"fr-FR",es:"es-ES","zh-CN":"zh-CN",ar:"ar-SA"})[locale]||"en-US";
  switch(engineId){
    case "google":return `https://www.google.com/complete/search?client=chrome&hl=${encodeURIComponent(tag)}&q=${q}`;
    case "yandex":return `https://suggest.yandex.com/suggest-ff.cgi?part=${q}&uil=${encodeURIComponent(tag.split("-")[0])}`;
    case "bing":return `https://www.bing.com/osjson.aspx?query=${q}&language=${encodeURIComponent(tag)}`;
    case "ddg":return `https://duckduckgo.com/ac/?q=${q}&type=list`;
    case "yahoo":return `https://search.yahoo.com/sugg/chrome?output=fxjson&appid=crmas&command=${q}`;
    case "ecosia":return `https://ac.ecosia.org/?q=${q}&mkt=${encodeURIComponent(tag)}&type=list&language=${encodeURIComponent(tag)}`;
    default:return null;
  }
}
function isUrlLikeSearchInput(query) {
  return /^(?:https?:\/\/|file:|[a-z][a-z\d+.-]*:|www\.)/i.test(query)
    || /^localhost(?::\d+)?(?:\/|$)/i.test(query)
    || /^(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?(?:\/|$)/.test(query)
    || (!/\s/.test(query) && /^[\w-]+\.[a-z\d-]+(?::\d+)?(?:\/|$)/i.test(query));
}
function parseSearchSuggestions(payload) {
  let candidates=[];
  if(Array.isArray(payload)){
    candidates=Array.isArray(payload[1])?payload[1]:payload.slice(1);
  }else if(payload&&typeof payload==="object"){
    for(const key of ["suggestions","results","items","g","r","data"]){if(Array.isArray(payload[key])){candidates=payload[key];break}}
  }
  const out=[],seen=new Set();
  for(const item of candidates){let value=typeof item==="string"?item:"";if(item&&typeof item==="object")for(const key of ["value","text","phrase","query","q","suggestion"])if(typeof item[key]==="string"&&item[key].trim()){value=item[key];break}value=String(value||"").replace(/[\r\n\t]/g," ").trim().slice(0,180);const key=value.toLocaleLowerCase();if(value&&key&&!seen.has(key)){seen.add(key);out.push(value);if(out.length===8)break}}
  return out;
}
function extensionStorePath(profileId) { const base=profileDataDirectory(profileId);return base?path.join(base,"extensions.json"):null; }
function readProfileExtensions(profileId) {
  if(extensionRegistryCache.has(profileId))return extensionRegistryCache.get(profileId);
  let entries=[];const file=extensionStorePath(profileId);
  if(file)try{const value=JSON.parse(fs.readFileSync(file,"utf8"));if(Array.isArray(value))entries=value.filter(item=>item&&typeof item.id==="string"&&typeof item.path==="string"&&typeof item.name==="string").slice(0,MAX_PROFILE_EXTENSIONS)}catch{}
  extensionRegistryCache.set(profileId,entries);return entries;
}
function saveProfileExtensions(profileId, entries) {
  const file=extensionStorePath(profileId);if(!file)return false;
  try{fs.mkdirSync(path.dirname(file),{recursive:true});const temp=`${file}.tmp`;fs.writeFileSync(temp,JSON.stringify(entries,null,2));fs.renameSync(temp,file);extensionRegistryCache.set(profileId,entries);return true}catch{return false}
}
function validateExtensionFolder(folder) {
  try {
    const root=fs.realpathSync(folder),rootStat=fs.statSync(root);if(!rootStat.isDirectory())return {ok:false,code:"invalid-folder"};
    const manifestFile=fs.realpathSync(path.join(root,"manifest.json")),relative=path.relative(root,manifestFile);
    if(relative.startsWith(`..${path.sep}`)||relative===".."||path.isAbsolute(relative))return {ok:false,code:"invalid-manifest"};
    const manifestStat=fs.statSync(manifestFile);if(!manifestStat.isFile()||manifestStat.size>1024*1024)return {ok:false,code:"invalid-manifest"};
    const manifest=JSON.parse(fs.readFileSync(manifestFile,"utf8"));
    if(!manifest||typeof manifest!=="object"||![2,3].includes(Number(manifest.manifest_version))||typeof manifest.version!=="string")return {ok:false,code:"invalid-manifest"};
    const strings=value=>Array.isArray(value)?[...new Set(value.filter(item=>typeof item==="string").map(item=>item.slice(0,160)))].slice(0,100):[];
    const name=String(manifest.name||manifest.short_name||path.basename(root)).replace(/[\r\n\t]/g," ").slice(0,100);
    const author=String(manifest.author||"").replace(/[\r\n\t]/g," ").slice(0,100);
    const description=String(manifest.description||"").replace(/[\r\n\t]/g," ").slice(0,240);
    return {ok:true,path:root,manifest:{name,version:manifest.version.slice(0,40),author,description,manifestVersion:Number(manifest.manifest_version),permissions:strings([...(manifest.permissions||[]),...(manifest.optional_permissions||[])]),hostPermissions:strings([...(manifest.host_permissions||[]),...(manifest.optional_host_permissions||[])])}};
  } catch { return {ok:false,code:"invalid-manifest"}; }
}
function setExtensionError(profileId,id,message) {
  let errors=extensionErrorsByProfile.get(profileId);if(!errors){errors=new Map();extensionErrorsByProfile.set(profileId,errors)}
  if(message)errors.set(id,String(message).replace(/[\r\n\t]/g," ").slice(0,180));else errors.delete(id);
}
async function ensureProfileExtensions(ses,profileId) {
  if(extensionLoadPromises.has(ses))return extensionLoadPromises.get(ses);
  const promise=(async()=>{
    if(!ses?.extensions?.loadExtension)return {ok:false,code:"unsupported"};
    const entries=readProfileExtensions(profileId);let changed=false;
    for(const entry of entries){
      if(!entry.enabled)continue;
      const checked=validateExtensionFolder(entry.path);
      if(!checked.ok){setExtensionError(profileId,entry.id,"Extension folder or manifest could not be read.");continue}
      try{const loaded=await ses.extensions.loadExtension(checked.path);entry.extensionId=loaded.id;entry.name=checked.manifest.name;entry.version=checked.manifest.version;entry.author=checked.manifest.author;entry.description=checked.manifest.description;entry.manifestVersion=checked.manifest.manifestVersion;entry.permissions=checked.manifest.permissions;entry.hostPermissions=checked.manifest.hostPermissions;setExtensionError(profileId,entry.id,null);changed=true}
      catch{setExtensionError(profileId,entry.id,"Extension could not be loaded.")}
    }
    if(changed)saveProfileExtensions(profileId,entries);
    return {ok:true};
  })();
  extensionLoadPromises.set(ses,promise);return promise;
}
function extensionSnapshot(state) {
  const entries=readProfileExtensions(state.profileId),api=state.session?.extensions,supported=!!api?.loadExtension;
  let loaded=[];try{loaded=api?.getAllExtensions?.()||[]}catch{}
  const errors=extensionErrorsByProfile.get(state.profileId)||new Map();
  return {ok:true,supported,privateMode:!!state.privateMode,extensions:entries.map(entry=>{
    const live=loaded.find(item=>item.id===entry.extensionId||path.resolve(item.path||"")===path.resolve(entry.path));
    const error=errors.get(entry.id)||"";
    return {id:entry.id,name:entry.name,version:entry.version,author:entry.author,description:entry.description,manifestVersion:entry.manifestVersion||2,permissions:Array.isArray(entry.permissions)?entry.permissions:[],hostPermissions:Array.isArray(entry.hostPermissions)?entry.hostPermissions:[],enabled:!!entry.enabled,loaded:!!live,status:state.privateMode&&entry.enabled?"private":error?"error":live?"active":entry.enabled?"error":"disabled",error:error?error.slice(0,160):""};
  }),limit:MAX_PROFILE_EXTENSIONS};
}
function broadcastExtensions(profileId) { for(const state of windows.values())if(state.profileId===profileId)send(state,"extensionsChanged",{}); }
function withExtensionProfileLock(profileId,operation) {
  const previous=extensionMutationQueues.get(profileId)||Promise.resolve();
  const current=previous.catch(()=>{}).then(operation);
  const queued=current.catch(()=>{}).then(()=>{if(extensionMutationQueues.get(profileId)===queued)extensionMutationQueues.delete(profileId)});
  extensionMutationQueues.set(profileId,queued);
  return current;
}
function sessionForProfile(profileId) {
  if(!profileRegistry.some(profile=>profile.id===profileId))return null;
  const partition=ProfileUtils.partitionFor(profileId);
  return partition?session.fromPartition(partition):session.defaultSession;
}
function permissionStorePath(profileId="default") { const base=profileDataDirectory(profileId);return base?path.join(base,"site-permissions.json"):null; }
function permissionsForProfile(profileId="default") {
  if(rememberedPermissionsByProfile.has(profileId))return rememberedPermissionsByProfile.get(profileId);
  const entries=new Map(),file=permissionStorePath(profileId);
  if(file)try{const data=JSON.parse(fs.readFileSync(file,"utf8"));if(Array.isArray(data))for(const [key,allowed] of data)if(typeof key==="string"&&typeof allowed==="boolean")entries.set(key,allowed)}catch{}
  rememberedPermissionsByProfile.set(profileId,entries);return entries;
}
function saveRememberedPermissions(profileId="default") {
  try { const entries=rememberedPermissionsByProfile.get(profileId),target=permissionStorePath(profileId);if(!entries||!target)return;const temp=`${target}.tmp`;fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(temp,JSON.stringify([...entries]));fs.renameSync(temp,target); } catch {}
}function addBounded(set, value) { if (!value || set.has(value)) return; if (set.size >= 2000) set.delete(set.values().next().value); set.add(value); }
function recordShieldBlock(url, tracker) {
  let host = ""; try { host = new URL(url).hostname.toLowerCase(); } catch {}
  shieldStats.blockedRequests++; addBounded(shieldStats.blockedDomains, host);
  if (tracker) { shieldStats.trackerRequests++; addBounded(shieldStats.trackerDomains, host); }
  if (shieldStats.blockedRequests % 10 === 0) saveShieldStats();
}
async function loadShieldStats() {
  try { const s = JSON.parse(await fs.promises.readFile(shieldCachePath("shield-stats.json"), "utf8")); shieldStats.blockedRequests = Math.max(0, Number(s.blockedRequests) || 0); shieldStats.trackerRequests = Math.max(0, Number(s.trackerRequests) || 0); for (const x of (s.blockedDomains || []).slice(-2000)) if (typeof x === "string") shieldStats.blockedDomains.add(x); for (const x of (s.trackerDomains || []).slice(-2000)) if (typeof x === "string") shieldStats.trackerDomains.add(x); } catch {}
}
function saveShieldStats() {
  if (shieldStatsSaveQueued) return; shieldStatsSaveQueued = true;
  setTimeout(async () => { shieldStatsSaveQueued = false; try { const file = shieldCachePath("shield-stats.json"), temp = `${file}.tmp`; await fs.promises.writeFile(temp, JSON.stringify({ blockedRequests: shieldStats.blockedRequests, blockedDomains: [...shieldStats.blockedDomains], trackerRequests: shieldStats.trackerRequests, trackerDomains: [...shieldStats.trackerDomains] })); await fs.promises.rename(temp, file); } catch {} }, 100).unref?.();
}
function persistShieldStatsNow() { try { fs.mkdirSync(path.dirname(shieldCachePath("shield-stats.json")), { recursive: true }); fs.writeFileSync(shieldCachePath("shield-stats.json"), JSON.stringify({ blockedRequests: shieldStats.blockedRequests, blockedDomains: [...shieldStats.blockedDomains], trackerRequests: shieldStats.trackerRequests, trackerDomains: [...shieldStats.trackerDomains] })); } catch {} }
function shieldCachePath(name) { return path.join(app.getPath("userData"), name); }
async function readShieldEngines() {
  const cached = shieldCachePath("shield-engine.bin"), privacy = shieldCachePath("shield-privacy.bin"), meta = shieldCachePath("shield-filters.json");
  try {
    const data = JSON.parse(await fs.promises.readFile(meta, "utf8"));
    shieldBlocker = ElectronBlocker.deserialize(await fs.promises.readFile(cached));
    shieldPrivacyBlocker = ElectronBlocker.deserialize(await fs.promises.readFile(privacy));
    shieldUpdatedAt = data.updatedAt || null;
    return;
  } catch {}
  try {
    const base = path.join(__dirname, "build");
    shieldBlocker = ElectronBlocker.deserialize(await fs.promises.readFile(path.join(base, "shield-engine.bin")));
    shieldPrivacyBlocker = ElectronBlocker.deserialize(await fs.promises.readFile(path.join(base, "shield-engine-1.bin")));
    shieldUpdatedAt = JSON.parse(await fs.promises.readFile(path.join(base, "shield-engine.json"), "utf8")).updatedAt;
  } catch (error) { console.error("Aegora Shield bundled filters unavailable:", error.message); }
}
async function updateShieldFilters() {
  if (shieldUpdatePromise) return shieldUpdatePromise;
  shieldUpdatePromise = (async () => {
    const texts = await Promise.all(shieldLists.map(async (url) => {
      const response = await fetch(url, { headers: { "user-agent": `Aegora Shield/${app.getVersion()}` }, signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw new Error(`Filter download failed (${response.status})`);
      const text = await response.text(); if (text.length < 10000) throw new Error("Filter list is unexpectedly small"); return text;
    }));
    const combined = ElectronBlocker.parse(texts.join("\n"));
    const privacy = ElectronBlocker.parse(texts[1]);
    const updatedAt = new Date().toISOString(), dir = app.getPath("userData");
    await fs.promises.mkdir(dir, { recursive: true });
    const payloads = [["shield-engine.bin", combined.serialize()], ["shield-privacy.bin", privacy.serialize()], ["shield-filters.json", Buffer.from(JSON.stringify({ updatedAt, lists: shieldLists }))]];
    for (const [name, bytes] of payloads) { const temp = shieldCachePath(`${name}.tmp`); await fs.promises.writeFile(temp, bytes); await fs.promises.rename(temp, shieldCachePath(name)); }
    shieldBlocker = combined; shieldPrivacyBlocker = privacy; shieldUpdatedAt = updatedAt;
    for (const state of windows.values()) configureShieldCosmetics(state.session);
    return { ok: true, updatedAt };
  })().catch((error) => ({ ok: false, error: String(error.message || error).slice(0, 180) })).finally(() => { shieldUpdatePromise = null; });
  return shieldUpdatePromise;
}
function shieldStatus(state) { return { enabled: !!state?.tracking, updatedAt: shieldUpdatedAt, lists: shieldLists.length, blockedRequests: shieldStats.blockedRequests, blockedDomains: shieldStats.blockedDomains.size, trackerRequests: shieldStats.trackerRequests, trackerDomains: shieldStats.trackerDomains.size, updating: !!shieldUpdatePromise }; }

const okUrl = (u) => /^https?:\/\//i.test(String(u || ""));
const same = (a, b) => { try { return new URL(a).href === new URL(b).href; } catch { return a === b; } };
const originOf = (u) => { try { return new URL(u).origin; } catch { return String(u); } };
const send = (state, ch, data) => { if (state?.ui && !state.ui.isDestroyed()) state.ui.send(ch, data); };
const stateFor = (wc) => contentOwners.get(wc?.id);
const linkSafe = (u) => { try { const p = new URL(u).protocol; return ["http:", "https:"].includes(p); } catch { return false; } };

async function vaultEncryptionAvailable() {
  if (!await safeStorage.isAsyncEncryptionAvailable()) return false;
  return process.platform !== "linux" || safeStorage.getSelectedStorageBackend() !== "basic_text";
}

async function writeVault(entries, profileId="default") {
  if (!await vaultEncryptionAvailable()) throw new Error("secure-storage-unavailable");
  const base=profileDataDirectory(profileId);if(!base)throw new Error("profile-unavailable");
  const target = path.join(base, "password-vault.dat");
  const encrypted = await safeStorage.encryptStringAsync(JSON.stringify(entries));
  const temp = `${target}.tmp`;
  await fs.promises.mkdir(path.dirname(target), { recursive: true });
  await fs.promises.writeFile(temp, Buffer.concat([VAULT_MAGIC, encrypted]));
  await fs.promises.rename(temp, target);
}

async function readVault(profileId="default") {
  if (!await vaultEncryptionAvailable()) throw new Error("secure-storage-unavailable");
  const base=profileDataDirectory(profileId);if(!base)throw new Error("profile-unavailable");
  const target = path.join(base, "password-vault.dat");
  let raw;
  try { raw = await fs.promises.readFile(target); } catch (error) { if (error.code === "ENOENT") return []; throw error; }
  if (!raw.subarray(0, VAULT_MAGIC.length).equals(VAULT_MAGIC)) throw new Error("vault-format-invalid");
  const decrypted = await safeStorage.decryptStringAsync(raw.subarray(VAULT_MAGIC.length));
  const entries = JSON.parse(decrypted.result);
  if (!Array.isArray(entries)) throw new Error("vault-format-invalid");
  if (decrypted.shouldReEncrypt) await writeVault(entries,profileId);
  return entries;
}

function mutateVault(mutator,profileId="default") {
  const operation = vaultQueue.then(async () => {
    const entries = await readVault(profileId);
    const result = await mutator(entries);
    await writeVault(entries,profileId);
    return result;
  });
  vaultQueue = operation.catch(() => {});
  return operation;
}

function layout(state) {
  if (state.win.isDestroyed()) return;
  const [width, height] = state.win.getContentSize();
  state.uiView.setBounds({ x: 0, y: 0, width, height });
  state.uiView.setVisible(!state.recovering && state.htmlFullscreen === null);
  for (const [id, view] of state.views) {
    const htmlFullscreen = state.htmlFullscreen === id;
    const visible = !state.recovering && (htmlFullscreen || (id === state.active && state.rect.width > 0 && state.rect.height > 0));
    view.setVisible(visible);
    if (visible) {
      if (htmlFullscreen) {
        view.setBounds({ x: 0, y: 0, width, height });
        try { view.setBorderRadius(0); } catch {}
      } else {
        view.setBounds(state.rect);
        try { view.setBorderRadius(14); } catch {}
      }
    }
  }
}

function showRecoveryPrompt(state, reason) {
  if (state.win.isDestroyed() || state.recoveryPromptOpen) return;
  state.recoveryPromptOpen = true;
  dialog.showMessageBox(state.win, {
    type: "error",
    title: "Aegora",
    message: "Aegora не удалось запустить.",
    detail: `Интерфейс не ответил после автоматической попытки восстановления (${reason}). Можно повторить запуск или закрыть окно.`,
    buttons: ["Повторить запуск", "Закрыть"],
    defaultId: 0,
    cancelId: 1,
    noLink: true
  }).then(({ response }) => {
    state.recoveryPromptOpen = false;
    if (state.win.isDestroyed()) return;
    if (response === 0) {
      state.uiRecoveryCount = 0;
      recoverUi(state, "manual-retry");
    } else {
      state.allowClose = true;
      state.win.close();
    }
  }).catch(() => { state.recoveryPromptOpen = false; });
}

function recoverUi(state, reason) {
  if (!state || state.win.isDestroyed() || state.allowClose || state.recovering) return;
  clearTimeout(state.uiStartupTimer);
  clearTimeout(state.uiUnresponsiveTimer);
  if (state.uiRecoveryCount >= 1) {
    showRecoveryPrompt(state, reason);
    return;
  }
  state.uiRecoveryCount += 1;
  state.recovering = true;
  state.uiReady = false;
  layout(state);
  state.ui.loadFile(path.join(__dirname, "renderer", "index.html"), { query: { recover: "1" } }).catch(() => {
    state.recovering = false;
    showRecoveryPrompt(state, reason);
  });
  state.uiStartupTimer = setTimeout(() => {
    state.recovering = false;
    recoverUi(state, "startup-timeout");
  }, 15000);
}

const KEYS = { t: "newtab", w: "closetab", l: "focusurl", r: "reload", f: "find", h: "history", j: "downloads", b: "bookmarks", d: "bookmark" };
function keys(state, wc) {
  return (event, input) => {
    if (input.type !== "keyDown") return;
    const key = (input.key || "").toLowerCase();
    if (key === "f11") { event.preventDefault(); if (state.htmlFullscreen !== null) { const fsView=state.views.get(state.htmlFullscreen); fsView?.webContents.executeJavaScript("document.exitFullscreen?.() ").catch(() => {}); } else { state.manualFullscreen=!state.manualFullscreen; state.win.setFullScreen(state.manualFullscreen); } return; }
    if (input.alt && key === "arrowleft") { event.preventDefault(); send(state, "key", "back"); return; }
    if (input.alt && key === "arrowright") { event.preventDefault(); send(state, "key", "forward"); return; }
    if ((input.alt && (key === " " || key === "space")) || ((input.control || input.meta) && input.shift && key === " ")) { event.preventDefault(); send(state, "key", "quickpanel"); return; }
    if (!(input.control || input.meta)) return;
    if (key === "tab") { event.preventDefault(); send(state, "key", input.shift ? "prevtab" : "nexttab"); return; }
    if (key === "t" && input.shift) { event.preventDefault(); send(state, "key", "restoretab"); return; }
    if (key === "n" && input.shift) { event.preventDefault(); send(state, "key", "private"); return; }
    if (/^[1-9]$/.test(key)) { event.preventDefault(); send(state, "key", `tab${key}`); return; }
    if (KEYS[key]) { event.preventDefault(); send(state, "key", KEYS[key]); }
    else if (wc !== state.ui && (key === "=" || key === "+")) { event.preventDefault(); wc.setZoomLevel(wc.getZoomLevel() + 0.5); }
    else if (wc !== state.ui && key === "-") { event.preventDefault(); wc.setZoomLevel(wc.getZoomLevel() - 0.5); }
    else if (wc !== state.ui && key === "0") { event.preventDefault(); wc.setZoomLevel(0); }
  };
}

function wire(state, id, wc) {
  const emit = (extra = {}) => send(state, "tab", { id, ...extra });
  wc.on("did-start-loading", () => emit({ loading: true }));
  wc.on("did-stop-loading", () => { state.loading.delete(id); if (state.tabCrashRetries.has(id)) setTimeout(() => state.tabCrashRetries.delete(id), 15000); emit({ loading: false }); });
  wc.on("render-process-gone", (_event, details = {}) => {
    state.loading.delete(id);
    const retry = state.tabCrashRetries.get(id) || 0;
    if (retry < 1 && details.reason !== "clean-exit") {
      state.tabCrashRetries.set(id, retry + 1);
      setTimeout(() => { if (state.views.get(id)?.webContents === wc && !wc.isDestroyed()) { try { wc.reload(); } catch { emit({ loading: false, fail: "The page stopped unexpectedly. Use Retry to reopen it." }); } } }, 700);
    } else if (details.reason !== "clean-exit") emit({ loading: false, fail: "The page stopped unexpectedly. Use Retry to reopen it." });
  });
  wc.on("enter-html-full-screen", () => { state.htmlFullscreen=id; state.htmlOwnsFullscreen=!state.win.isFullScreen(); if(state.htmlOwnsFullscreen) state.win.setFullScreen(true); layout(state); });
  wc.on("leave-html-full-screen", () => { if(state.htmlFullscreen!==id)return; state.htmlFullscreen=null; const exitWindow=state.htmlOwnsFullscreen; state.htmlOwnsFullscreen=false; if(exitWindow&&state.win.isFullScreen()) state.win.setFullScreen(false); layout(state); });
  wc.on("did-navigate", (_event, url) => emit({ nav: 1, url, title: wc.getTitle() }));
  wc.on("did-navigate-in-page", (_event, url, isMainFrame) => { if (isMainFrame) emit({ nav: 1, url, title: wc.getTitle() }); });
  wc.on("page-title-updated", (_event, title) => emit({ title }));
  wc.on("audio-state-changed", () => emit({ audio: wc.isCurrentlyAudible() }));
  emit({ audio: wc.isCurrentlyAudible() });
  wc.on("page-favicon-updated", (_event, favicons) => { if (favicons?.[0]) emit({ fav: favicons[0] }); });
  wc.on("found-in-page", (_event, result) => send(state, "findResult", { id, result }));
  wc.on("did-fail-load", (_event, code, description, url, isMainFrame) => { if (isMainFrame && code !== -3) { state.loading.delete(id); send(state, "tab", { id, fail: description, url, loading: false }); } });
  wc.on("will-navigate", (event, url) => {
    if (okUrl(url) || /^blob:/i.test(url) || url === "about:blank") return;
    event.preventDefault();
    if (/^(mailto|tel):/i.test(url)) shell.openExternal(url).catch(() => {});
  });
  wc.on("will-redirect", (event, url, _isInPlace, isMainFrame) => {
    if (isMainFrame && !okUrl(url)) event.preventDefault();
  });
  wc.setWindowOpenHandler(({ url }) => { if (okUrl(url)) send(state, "newtab", { url }); return { action: "deny" }; });
  wc.on("before-input-event", keys(state, wc));
  wc.on("context-menu", (_event, params) => {
    const template = [];
    if (params.linkURL && okUrl(params.linkURL)) template.push({ label: "Open link in new tab", click: () => send(state, "newtab", { url: params.linkURL }) }, { label: "Copy link address", click: () => clipboard.writeText(params.linkURL) }, { type: "separator" });
    if (params.isEditable) template.push({ role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" });
    else if (params.selectionText) template.push({ role: "copy" });
    if (params.mediaType === "image" && params.srcURL) template.push({ label: "Copy image address", click: () => clipboard.writeText(params.srcURL) });
    if (wc.navigationHistory.canGoBack()) template.push({ label: "Back", click: () => wc.navigationHistory.goBack() });
    if (template.length) Menu.buildFromTemplate(template).popup({ window: state.win });
  });
  contentOwners.set(wc.id, state);
  wc.once("destroyed", () => {
    contentOwners.delete(wc.id);
    for (const [permissionId, request] of pendingPermissions) if (request.webContents === wc) resolvePermission(permissionId, false);
  });
}

function getView(state, id) {
  let view = state.views.get(id);
  if (view) return view;
  view = new WebContentsView({ webPreferences: { session: state.session, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, allowRunningInsecureContent: false, webviewTag: false, spellcheck: true } });
  state.views.set(id, view);
  state.win.contentView.addChildView(view, 0);
  try { view.setBorderRadius(14); } catch {}
  wire(state, id, view.webContents);
  return view;
}
function loadPageAfterExtensions(state,id,webContents,url) {
  const request=(state.loadRequestIds.get(id)||0)+1;state.loadRequestIds.set(id,request);state.loading.set(id,url);
  Promise.resolve(state.extensionsReady).catch(()=>{}).then(()=>{
    if(state.loadRequestIds.get(id)!==request||state.views.get(id)?.webContents!==webContents||webContents.isDestroyed())return;
    return webContents.loadURL(url);
  }).catch(()=>{}).finally(()=>{if(state.loadRequestIds.get(id)===request&&state.loading.get(id)===url)state.loading.delete(id)});
}

function createWindow({ privateMode = false, ses = null, profileId = "default" } = {}) {
  if(!ses)ses=privateMode?session.fromPartition(`aegora-private-${randomUUID()}`):sessionForProfile(profileId);
  if(!ses)throw new Error("profile-unavailable");
  const win = new BaseWindow({
    width: 1280, height: 820, minWidth: 640, minHeight: 480, title: privateMode ? "Aegora — Private" : (profileId==="default"?"Aegora":`Aegora — ${profileRegistry.find(x=>x.id===profileId)?.name||"Profile"}`), backgroundColor: "#0d0d12",
    icon: path.join(__dirname, "build", "icon.ico")
  });
  if (process.platform !== "darwin") win.removeMenu();
  const uiView = new WebContentsView({ webPreferences: { session: ses, preload: path.join(__dirname, "preload.js"), sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, allowRunningInsecureContent: false, webviewTag: false, transparent: true } });
  uiView.setBackgroundColor("#00000000");
  const [width, height] = win.getContentSize();
  uiView.setBounds({ x: 0, y: 0, width, height });
  win.contentView.addChildView(uiView);
  const state = { win, uiView, ui: uiView.webContents, session: ses, privateMode, profileId, views: new Map(), loading: new Map(), loadRequestIds: new Map(), extensionSelections: new Map(), extensionsReady: Promise.resolve(), permissions: privateMode ? new Map() : permissionsForProfile(profileId), permissionRequests: new Set(), active: null, overlay: false, rect: { x: 0, y: 0, width: 0, height: 0 }, allowClose: false, tracking: false, htmlFullscreen: null, htmlOwnsFullscreen: false, manualFullscreen: false, uiReady: false, uiRecoveryCount: 0, uiStartupTimer: null, uiUnresponsiveTimer: null, recoveryPromptOpen: false, recovering: false, tabCrashRetries: new Map() };
  windows.set(state.ui.id, state);
  contentOwners.set(state.ui.id, state);
  if (!privateMode) for (const other of windows.values()) if (other !== state && !other.privateMode) send(other, "profilesChanged", {});
  win.on("resize", () => layout(state));
  state.ui.on("before-mouse-event", (event, mouse) => {
    if (state.recovering || state.overlay || state.htmlFullscreen !== null || !state.active || mouse.x < state.rect.x || mouse.y < state.rect.y || mouse.x >= state.rect.x + state.rect.width || mouse.y >= state.rect.y + state.rect.height) return;
    const page = state.views.get(state.active)?.webContents;
    if (!page || page.isDestroyed()) return;
    event.preventDefault();
    try {
      const forwarded={...mouse,x:mouse.x-state.rect.x,y:mouse.y-state.rect.y};
      if(mouse.type==="mouseWheel"){
        forwarded.deltaX=-(mouse.deltaX||0);
        forwarded.deltaY=-(mouse.deltaY||0);
        forwarded.wheelTicksX=Number.isInteger(mouse.wheelTicksX)?-mouse.wheelTicksX:-Math.sign(mouse.deltaX||0)*Math.max(1,Math.round(Math.abs(mouse.deltaX||0)/100));
        forwarded.wheelTicksY=Number.isInteger(mouse.wheelTicksY)?-mouse.wheelTicksY:-Math.sign(mouse.deltaY||0)*Math.max(1,Math.round(Math.abs(mouse.deltaY||0)/100));
        if(typeof forwarded.hasPreciseScrollingDeltas!=="boolean")forwarded.hasPreciseScrollingDeltas=false;
        forwarded.canScroll=true;
      }
      if(mouse.type==="mouseDown"||mouse.type==="mouseWheel")page.focus();
      page.sendInputEvent(forwarded);
    } catch {}
  });
  configureSession(ses, state);
  state.extensionsReady=privateMode?Promise.resolve({ok:true,code:"private"}):ensureProfileExtensions(ses,profileId);
  state.ui.on("render-process-gone", (_event, details = {}) => { if (details.reason !== "clean-exit") recoverUi(state, details.reason || "renderer-crash"); });
  state.ui.on("unresponsive", () => { clearTimeout(state.uiUnresponsiveTimer); state.uiUnresponsiveTimer = setTimeout(() => recoverUi(state, "unresponsive"), 8000); });
  state.ui.on("responsive", () => clearTimeout(state.uiUnresponsiveTimer));
  state.ui.on("did-fail-load", (_event, code, _description, _url, isMainFrame) => { if (isMainFrame && code !== -3) recoverUi(state, "interface-load-failed"); });
  state.uiStartupTimer = setTimeout(() => recoverUi(state, "startup-timeout"), 15000);
  state.ui.loadFile(path.join(__dirname, "renderer", "index.html")).catch(() => recoverUi(state, "interface-load-failed"));
  state.ui.on("will-navigate", (event) => event.preventDefault());
  state.ui.setWindowOpenHandler(() => ({ action: "deny" }));
  state.ui.on("before-input-event", keys(state, state.ui));
  state.ui.once("did-finish-load", () => {
    if (state === mainState && pendingUrls.length) pendingUrls.splice(0).forEach((url) => send(state, "newtab", { url }));
  });
  win.on("close", (event) => { if (state.allowClose) return; event.preventDefault(); if (!state.closeDialogPending) { state.closeDialogPending = true; send(state, "closeRequested", {}); } });
  win.on("closed", () => {
    clearTimeout(state.uiStartupTimer);
    clearTimeout(state.uiUnresponsiveTimer);
    for (const [id, view] of state.views) {
      try { win.contentView.removeChildView(view); view.webContents.close(); } catch {}
      state.loading.delete(id);
      state.loadRequestIds.delete(id);
    }
    state.views.clear();state.extensionSelections.clear();
    windows.delete(state.ui.id);
    contentOwners.delete(state.ui.id);
    try { state.ui.close(); } catch {}
    if (state === mainState) {
      mainState = [...windows.values()].find((candidate) => !candidate.privateMode && !candidate.win.isDestroyed()) || null;
    }
    if (!privateMode) for (const other of windows.values()) if (!other.privateMode) send(other, "profilesChanged", {});
    if (privateMode) ses.clearStorageData().catch(() => {});
  });
  return state;
}

function createPrivateWindow(profileId="default") {
  const ses = session.fromPartition(`aegora-private-${randomUUID()}`);
  const state = createWindow({ privateMode: true, ses, profileId });
  state.win.focus();
}

function requestPermission(state, webContents, permission, details, callback) {
  const origin = originOf(details?.requestingUrl || webContents.getURL());
  const mediaTypes = Array.isArray(details?.mediaTypes) ? [...new Set(details.mediaTypes.filter((type) => type === "audio" || type === "video"))] : [];
  const keys = permission === "media" && mediaTypes.length ? mediaTypes.map((type) => `${origin}|media:${type}`) : [`${origin}|${permission}`];
  const remembered = keys.map((key) => state.permissions.get(key));
  if (remembered.every((value) => value !== undefined)) { callback(remembered.every(Boolean)); return; }
  const id = String(++permissionId);
  pendingPermissions.set(id, { state, webContents, callback, keys, origin, permission });
  state.permissionRequests.add(id);
  layout(state);
  send(state, "permissionRequest", { id, origin, permission, mediaTypes });
}

function resolvePermission(id, allowed, remember = false) {
  const request = pendingPermissions.get(String(id));
  if (!request) return;
  pendingPermissions.delete(String(id));
  const { state, keys, callback } = request;
  state.permissionRequests.delete(String(id));
  if (remember) for (const key of keys) state.permissions.set(key, !!allowed);
  if (remember && !state.privateMode) saveRememberedPermissions(state.profileId);
  try { callback(!!allowed); } finally {
    layout(state);
    if (remember) send(state, "permissions", [...state.permissions].map(([entry, value]) => { const [origin, permission] = entry.split("|"); return { origin, permission, allowed: value }; }));
  }
}

const trackerHosts = ["doubleclick.net", "googlesyndication.com", "google-analytics.com", "googletagmanager.com", "connect.facebook.net", "hotjar.com", "clarity.ms", "segment.io", "adsrvr.org", "adnxs.com", "adservice.google.com", "amazon-adsystem.com", "criteo.com", "demdex.net", "everesttech.net", "scorecardresearch.com", "taboola.com", "outbrain.com", "rubiconproject.com", "openx.net", "pubmatic.com", "quantserve.com", "mixpanel.com", "amplitude.com", "branch.io", "newrelic.com", "nr-data.net", "smartadserver.com", "bidswitch.net", "lijit.com"];
const trackerAllowedHosts = ["pixelya.fun", "challenges.cloudflare.com", "challenges.cloudflare.net", "challenges.cloudflareinsights.com"];
function hostMatches(host, root) { return host === root || host.endsWith(`.${root}`); }

function configureShieldCosmetics(ses) {
  if (!shieldBlocker?.config?.loadCosmeticFilters) return;
  if (!shieldCosmeticIpcRegistered) {
    try {
      ipcMain.handle("@ghostery/adblocker/inject-cosmetic-filters", (event, url, msg) => {
        const state = contentOwners.get(event.sender.id);
        if (state?.tracking && shieldBlocker) return shieldBlocker.onInjectCosmeticFilters(event, url, msg);
      });
      ipcMain.handle("@ghostery/adblocker/is-mutation-observer-enabled", (event) => {
        const state = contentOwners.get(event.sender.id);
        return !!state?.tracking && !!shieldBlocker?.config?.enableMutationObserver;
      });
      shieldCosmeticIpcRegistered = true;
    } catch (error) { console.error("Aegora Shield cosmetic handlers unavailable:", error.message); return; }
  }
  if (shieldCosmeticSessions.has(ses)) return;
  try {
    ses.registerPreloadScript({ type: "frame", filePath: require.resolve("@ghostery/adblocker-electron-preload") });
    shieldCosmeticSessions.add(ses);
  } catch (error) { console.error("Aegora Shield cosmetic preload unavailable:", error.message); }
}

function configureSession(ses, fallbackState) {
  if (configuredSessions.has(ses)) return;
  configuredSessions.add(ses);
  configureShieldCosmetics(ses);
  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    const state = contentOwners.get(details.webContentsId) || fallbackState;
    const requestHeaders = details.requestHeaders || {};
    if (state?.tracking) { requestHeaders.DNT = "1"; requestHeaders["Sec-GPC"] = "1"; }
    if (state?.language) { const language = String(state.language).replace(/[^a-zA-Z0-9-]/g, ""); requestHeaders["Accept-Language"] = `${language},${language.split("-")[0]};q=0.9,en-US;q=0.8,en;q=0.7`; }
    callback({ requestHeaders });
  });
  ses.webRequest.onBeforeRequest((details, callback) => {
    const state = contentOwners.get(details.webContentsId) || fallbackState;
    let host = "";
    try { host = new URL(details.url).hostname.toLowerCase(); } catch {}
    const allowed = trackerAllowedHosts.some((root) => hostMatches(host, root));
    const legacyTracker = trackerHosts.some((root) => hostMatches(host, root));
    if (!state?.tracking || allowed) { callback({}); return; }
    if (legacyTracker) { recordShieldBlock(details.url, true); callback({ cancel: true }); return; }
    if (shieldBlocker) {
      try {
        const request = fromElectronDetails(details), isTracker = !!shieldPrivacyBlocker?.match(request).match;
        shieldBlocker.onBeforeRequest(details, (response) => { if (response.cancel || response.redirectURL) recordShieldBlock(details.url, isTracker); callback(response); });
        return;
      } catch {}
    }
    callback({});
  });
  ses.on("will-download", (_event, item, webContents) => {
    const state = contentOwners.get(webContents?.id) || fallbackState;
    const id = String(++downloadId), dir = app.getPath("downloads");
    const { name, ext } = path.parse(item.getFilename());
    let filePath = path.join(dir, name + ext), number = 1;
    while (fs.existsSync(filePath)) filePath = path.join(dir, `${name} (${number++})${ext}`);
    item.setSavePath(filePath); downloadItems.set(id, item); knownDownloads.add(filePath);
    let last = Date.now(), lastBytes = 0;
    const emit = (downloadState) => {
      const now = Date.now(), received = item.getReceivedBytes();
      const speed = downloadState === "progressing" && now > last ? (received - lastBytes) / ((now - last) / 1000) : 0;
      if (downloadState === "progressing") { last = now; lastBytes = received; }
      send(state, "dl", { id, name: path.basename(filePath), path: filePath, url: item.getURL(), total: item.getTotalBytes(), received, speed, state: downloadState });
    };
    emit("progressing");
    item.on("updated", (_ev, status) => { if (status === "interrupted") emit("interrupted"); else if (Date.now() - last > 400) emit("progressing"); });
    item.once("done", (_ev, status) => { emit(status === "completed" ? "completed" : status === "cancelled" ? "cancelled" : "interrupted"); downloadItems.delete(id);  });
  });
  ses.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const state = contentOwners.get(webContents?.id) || fallbackState;
    if (!state || permission === "fullscreen" || permission === "pointerLock") { callback(!!state); return; }
    requestPermission(state, webContents, permission, details, callback);
  });
  ses.setPermissionCheckHandler((webContents, permission, origin, details) => {
    const state = contentOwners.get(webContents?.id) || fallbackState;
    if (!state) return false;
    if (permission === "fullscreen" || permission === "pointerLock") return true;
    const key = permission === "media" && details?.mediaType ? `${originOf(origin)}|media:${details.mediaType}` : `${originOf(origin)}|${permission}`;
    return state.permissions.get(key) === true;
  });
}

const forSender = (event) => windows.get(event.sender.id);
function publishUpdateStatus(status, extra = {}) {
  updateStatus = { status, ...extra };
  for (const state of windows.values()) send(state, "updateStatus", updateStatus);
}
function requestAegoraUpdateCheck(force = false) {
  if (!autoUpdater) return Promise.resolve({ ok: false, code: "unavailable" });
  if (updateStatus.status === "downloaded") return Promise.resolve({ ok: true, code: "downloaded" });
  if (updateCheckPromise) return updateCheckPromise;
  if (!force && Date.now() - lastUpdateCheckAt < 5 * 60 * 1000) return Promise.resolve({ ok: true, code: "recent" });
  lastUpdateCheckAt = Date.now();
  publishUpdateStatus("checking");
  updateCheckPromise = Promise.resolve().then(() => autoUpdater.checkForUpdates()).then(() => ({ ok: true })).catch(() => ({ ok: false, code: "check-failed" })).finally(() => { updateCheckPromise = null; });
  return updateCheckPromise;
}
function initializeAutoUpdater() {
  if (!app.isPackaged || process.platform !== "win32") return;
  const updateConfig = path.join(process.resourcesPath, "app-update.yml");
  if (!fs.existsSync(updateConfig)) return;
  try { autoUpdater = require("electron-updater").autoUpdater; } catch { return; }
  const alphaBuild = /-alpha(?:\.|$)/i.test(app.getVersion());
  autoUpdater.channel = alphaBuild ? "alpha" : "latest";
  autoUpdater.allowPrerelease = alphaBuild;
  autoUpdater.allowDowngrade = false;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.autoRunAppAfterInstall = true;
  // Aegora deliberately ships the small NSIS web installer; let its verified
  // companion package be used for in-app updates too.
  autoUpdater.disableWebInstaller = false;
  autoUpdater.on("checking-for-update", () => publishUpdateStatus("checking"));
  autoUpdater.on("update-available", info => publishUpdateStatus("available", { version: String(info?.version || "").slice(0, 32) }));
  autoUpdater.on("update-not-available", () => publishUpdateStatus("not-available"));
  autoUpdater.on("download-progress", progress => publishUpdateStatus("progress", { version: String(progress?.version || updateStatus.version || "").slice(0, 32), percent: Math.max(0, Math.min(100, Number(progress?.percent) || 0)) }));
  autoUpdater.on("update-downloaded", info => publishUpdateStatus("downloaded", { version: String(info?.version || updateStatus.version || "").slice(0, 32) }));
  autoUpdater.on("error", error => {
    const message = String(error?.message || "Update failed").replace(/[\r\n\t]/g, " ").slice(0, 180);
    publishUpdateStatus("error", { message });
  });
  const startupDelay = 20000 + Math.floor(Math.random() * 15000);
  setTimeout(() => requestAegoraUpdateCheck(false), startupDelay).unref?.();
  const timer = setInterval(() => requestAegoraUpdateCheck(false), 6 * 60 * 60 * 1000);
  timer.unref?.();
}
ipcMain.handle("checkForUpdates", event => {
  if (!forSender(event)) return { ok: false, code: "unavailable" };
  return requestAegoraUpdateCheck(true);
});
ipcMain.on("installUpdate", event => {
  if (!forSender(event) || !autoUpdater || updateStatus.status !== "downloaded") return;
  autoUpdater.quitAndInstall(false, true);
});
ipcMain.handle("searchSuggestions",async(event,rawQuery,engineId,rawLocale)=>{
  const state=forSender(event);if(!state||state.privateMode)return [];
  const senderId=event.sender.id;pendingSearchSuggestions.get(senderId)?.controller.abort();
  const query=typeof rawQuery==="string"?rawQuery.trim().slice(0,120):"";
  const locale=["ru","en","fr","es","zh-CN","ar"].includes(rawLocale)?rawLocale:"en";
  if(query.length<2||isUrlLikeSearchInput(query))return [];
  const url=suggestionRequestUrl(String(engineId||""),query,locale);if(!url)return [];
  const controller=new AbortController(),request={controller};pendingSearchSuggestions.set(senderId,request);const timeout=setTimeout(()=>controller.abort(),2400);timeout.unref?.();
  try{
    const response=await fetch(url,{signal:controller.signal,redirect:"error",credentials:"omit",cache:"no-store",referrerPolicy:"no-referrer",headers:{accept:"application/json,text/plain;q=0.9","user-agent":`Aegora/${app.getVersion()}`}});
    if(!response.ok)return [];
    const declaredLength=Number(response.headers.get("content-length")||0);if(declaredLength>80000)return [];
    if(!response.body)return [];
    const reader=response.body.getReader(),chunks=[];let total=0;
    while(true){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>80000){await reader.cancel();return []}chunks.push(Buffer.from(value))}
    const text=Buffer.concat(chunks,total).toString("utf8");
    const jsonText=text.replace(/^\)\]\}',?\s*/,"");
    return parseSearchSuggestions(JSON.parse(jsonText));
  }catch{return []}finally{clearTimeout(timeout);if(pendingSearchSuggestions.get(senderId)===request)pendingSearchSuggestions.delete(senderId)}
});
ipcMain.on("cancelSearchSuggestions",event=>{const state=forSender(event);if(!state)return;pendingSearchSuggestions.get(event.sender.id)?.controller.abort()});
function openProfileWindow(profileId) {
  if(!profileRegistry.some(profile=>profile.id===profileId))return {ok:false,code:"profile-missing"};
  if(deletingProfiles.has(profileId))return {ok:false,code:"profile-deleting"};
  const existing=[...windows.values()].find(state=>!state.privateMode&&state.profileId===profileId&&!state.win.isDestroyed());
  if(existing){if(existing.win.isMinimized())existing.win.restore();existing.win.focus();return {ok:true,reused:true};}
  try{const ses=sessionForProfile(profileId);if(!ses)return {ok:false,code:"profile-missing"};const state=createWindow({profileId,ses});state.win.focus();return {ok:true,reused:false};}catch{return {ok:false,code:"open-failed"};}
}
ipcMain.handle("profilesList",event=>{const state=forSender(event);if(!state)return {ok:false,profiles:[]};const openProfiles=new Set([...windows.values()].filter(item=>!item.privateMode&&!item.win.isDestroyed()).map(item=>item.profileId));return {ok:true,profiles:profileRegistry.map(profile=>({id:profile.id,name:profile.name,isDefault:profile.id==="default",isCurrent:profile.id===state.profileId,isOpen:openProfiles.has(profile.id)}))};});
ipcMain.handle("profileCreate",(event,name)=>{if(!forSender(event))return {ok:false,code:"unavailable"};const validation=ProfileUtils.validateProfileName(name,profileRegistry);if(!validation.ok)return validation;const profile={id:randomUUID().toLowerCase(),name:validation.name,isDefault:false},previous=profileRegistry;profileRegistry=ProfileUtils.normalizeProfiles([...profileRegistry,profile]);if(!profileRegistry.some(item=>item.id===profile.id))return {ok:false,code:"limit"};if(!saveProfileRegistry()){profileRegistry=previous;return {ok:false,code:"save-failed"}}return {ok:true,id:profile.id};});
ipcMain.handle("profileDelete",async(event,id)=>{
  const state=forSender(event);
  if(!state||typeof id!=="string")return {ok:false,code:"unavailable"};
  const profile=profileRegistry.find(item=>item.id===id);
  if(!profile)return {ok:false,code:"profile-missing"};
  if(profile.isDefault||id==="default")return {ok:false,code:"default-protected"};
  if(deletingProfiles.has(id))return {ok:false,code:"profile-deleting"};
  if([...windows.values()].some(item=>!item.privateMode&&!item.win.isDestroyed()&&item.profileId===id))return {ok:false,code:"in-use"};
  deletingProfiles.add(id);
  try{
    const profileSession=sessionForProfile(id),dataDirectory=profileDataDirectory(id);
    if(!profileSession||!dataDirectory)return {ok:false,code:"profile-missing"};
    await ensureProfileExtensions(profileSession,id).catch(()=>{});
    await profileSession.clearStorageData();
    await profileSession.clearCache();
    profileSession.flushStorageData();
    const previous=profileRegistry;
    profileRegistry=profileRegistry.filter(item=>item.id!==id);
    if(!saveProfileRegistry()){profileRegistry=previous;return {ok:false,code:"delete-failed"};}
    try{await fs.promises.rm(dataDirectory,{recursive:true,force:true})}catch(error){profileRegistry=previous;saveProfileRegistry();throw error}
    try{for(const extension of profileSession.extensions?.getAllExtensions?.()||[])profileSession.extensions.removeExtension(extension.id)}catch{}
    rememberedPermissionsByProfile.delete(id);extensionRegistryCache.delete(id);extensionErrorsByProfile.delete(id);
    return {ok:true};
  }catch(error){
    console.error("Aegora profile deletion failed:",error?.message||error);
    return {ok:false,code:"delete-failed"};
  }finally{deletingProfiles.delete(id)}
});
ipcMain.handle("profileOpen",(event,id)=>{if(!forSender(event)||typeof id!=="string")return {ok:false,code:"unavailable"};return openProfileWindow(id);});ipcMain.on("appReady", (event) => { const state = forSender(event); if (!state) return; state.uiReady = true; state.recovering = false; clearTimeout(state.uiStartupTimer); clearTimeout(state.uiUnresponsiveTimer); layout(state); if(updateStatus.status!=="idle")send(state,"updateStatus",updateStatus); });
ipcMain.handle("extensionsList",async event=>{const state=forSender(event);if(!state)return {ok:false,extensions:[]};if(!state.privateMode)await state.extensionsReady.catch(()=>{});return extensionSnapshot(state)});
ipcMain.handle("extensionSelect",async event=>{
  const state=forSender(event);if(!state)return {ok:false,code:"unavailable"};if(state.privateMode)return {ok:false,code:"private"};
  const result=await dialog.showOpenDialog(state.win,{title:"Select an unpacked extension",properties:["openDirectory"]});
  if(result.canceled||!result.filePaths?.[0])return {ok:false,code:"cancelled"};
  const checked=validateExtensionFolder(result.filePaths[0]);if(!checked.ok)return checked;
  const token=randomUUID();if(state.extensionSelections.size>=5)state.extensionSelections.delete(state.extensionSelections.keys().next().value);state.extensionSelections.set(token,{path:checked.path,manifest:checked.manifest,expiresAt:Date.now()+5*60*1000});
  for(const [key,value]of state.extensionSelections)if(value.expiresAt<Date.now())state.extensionSelections.delete(key);
  return {ok:true,token,...checked.manifest};
});
ipcMain.handle("extensionInstall",async(event,token)=>{
  const state=forSender(event);if(!state)return {ok:false,code:"unavailable"};if(state.privateMode)return {ok:false,code:"private"};
  await state.extensionsReady.catch(()=>{});
  return withExtensionProfileLock(state.profileId,async()=>{
    if(!state.session?.extensions?.loadExtension)return {ok:false,code:"unsupported"};
    const selected=state.extensionSelections.get(String(token));state.extensionSelections.delete(String(token));if(!selected||selected.expiresAt<Date.now())return {ok:false,code:"selection-expired"};
    const checked=validateExtensionFolder(selected.path);if(!checked.ok||checked.manifest.version!==selected.manifest.version||checked.manifest.name!==selected.manifest.name)return {ok:false,code:"invalid-manifest"};
    const entries=readProfileExtensions(state.profileId);if(entries.length>=MAX_PROFILE_EXTENSIONS)return {ok:false,code:"limit"};
    if(entries.some(entry=>path.resolve(entry.path)===checked.path))return {ok:false,code:"duplicate"};
    let loaded=null,wasAlreadyLoaded=false;
    try{loaded=(state.session.extensions.getAllExtensions()||[]).find(item=>path.resolve(item.path||"")===checked.path)||null;if(loaded)wasAlreadyLoaded=true;else loaded=await state.session.extensions.loadExtension(checked.path)}catch{return {ok:false,code:"load-failed"}}
    const entry={id:randomUUID().toLowerCase(),extensionId:loaded.id,path:checked.path,...checked.manifest,enabled:true,installedAt:new Date().toISOString()};
    if(!saveProfileExtensions(state.profileId,[...entries,entry])){if(!wasAlreadyLoaded)try{state.session.extensions.removeExtension(loaded.id)}catch{}return {ok:false,code:"save-failed"}}
    setExtensionError(state.profileId,entry.id,null);broadcastExtensions(state.profileId);return {ok:true,id:entry.id};
  });
});
ipcMain.handle("extensionSetEnabled",async(event,id,enabled)=>{
  const state=forSender(event);if(!state)return {ok:false,code:"unavailable"};if(state.privateMode)return {ok:false,code:"private"};if(typeof id!=="string"||typeof enabled!=="boolean")return {ok:false,code:"invalid"};
  await state.extensionsReady.catch(()=>{});
  return withExtensionProfileLock(state.profileId,async()=>{
    const entries=readProfileExtensions(state.profileId),index=entries.findIndex(entry=>entry.id===id);if(index<0)return {ok:false,code:"missing"};const entry={...entries[index]};if(entry.enabled===enabled)return {ok:true};if(!state.session?.extensions?.loadExtension)return {ok:false,code:"unsupported"};
    if(enabled){
      const checked=validateExtensionFolder(entry.path);if(!checked.ok){setExtensionError(state.profileId,id,"Extension folder or manifest could not be read.");return {ok:false,code:"folder-missing"}}
      try{const loaded=await state.session.extensions.loadExtension(checked.path);entry.extensionId=loaded.id;Object.assign(entry,checked.manifest)}catch{setExtensionError(state.profileId,id,"Extension could not be loaded.");return {ok:false,code:"load-failed"}}
      entry.enabled=true;
      if(!saveProfileExtensions(state.profileId,entries.map((item,i)=>i===index?entry:item))){try{state.session.extensions.removeExtension(entry.extensionId)}catch{}return {ok:false,code:"save-failed"}}
      setExtensionError(state.profileId,id,null);
    }else{
      try{const loaded=(state.session.extensions.getAllExtensions()||[]).find(item=>item.id===entry.extensionId||path.resolve(item.path||"")===path.resolve(entry.path));if(loaded)state.session.extensions.removeExtension(loaded.id)}catch{return {ok:false,code:"unload-failed"}}
      entry.enabled=false;
      if(!saveProfileExtensions(state.profileId,entries.map((item,i)=>i===index?entry:item))){try{const loaded=await state.session.extensions.loadExtension(entry.path);entry.extensionId=loaded.id;saveProfileExtensions(state.profileId,entries)}catch{}return {ok:false,code:"save-failed"}}
      setExtensionError(state.profileId,id,null);
    }
    broadcastExtensions(state.profileId);return {ok:true};
  });
});
ipcMain.handle("extensionRemove",async(event,id)=>{
  const state=forSender(event);if(!state)return {ok:false,code:"unavailable"};if(state.privateMode)return {ok:false,code:"private"};if(typeof id!=="string")return {ok:false,code:"invalid"};
  await state.extensionsReady.catch(()=>{});
  return withExtensionProfileLock(state.profileId,async()=>{
    const entries=readProfileExtensions(state.profileId),entry=entries.find(item=>item.id===id);if(!entry)return {ok:false,code:"missing"};
    if(entry.enabled&&state.session?.extensions?.removeExtension)try{const loaded=(state.session.extensions.getAllExtensions()||[]).find(item=>item.id===entry.extensionId||path.resolve(item.path||"")===path.resolve(entry.path));if(loaded)state.session.extensions.removeExtension(loaded.id)}catch{return {ok:false,code:"unload-failed"}}
    const next=entries.filter(item=>item.id!==id);if(!saveProfileExtensions(state.profileId,next))return {ok:false,code:"save-failed"};setExtensionError(state.profileId,id,null);broadcastExtensions(state.profileId);return {ok:true};
  });
});
ipcMain.on("show", (event, id, rect, url, force) => {
  const state = forSender(event); if (!state) return;
  state.active = id;
  state.rect = { x: rect.x | 0, y: rect.y | 0, width: Math.max(0, rect.width | 0), height: Math.max(0, rect.height | 0) };
  const first = !state.views.has(id);
  const view = getView(state, id);
  if (first && url && okUrl(url)) {
    loadPageAfterExtensions(state,id,view.webContents,url);
  }
  layout(state);
});
ipcMain.on("navigate", (event, id, url, force = false) => {
  const state = forSender(event); if (!state || !okUrl(url)) return;
  const wc = getView(state, id).webContents;
  if (!force && same(wc.getURL(), url)) return;
  if (wc.isLoading() && state.loading.get(id) === url) return;
  loadPageAfterExtensions(state,id,wc,url);
});
ipcMain.on("hide", (event) => { const state = forSender(event); if (state) { state.active = null; layout(state); } });
ipcMain.on("bounds", (event, rect) => { const state = forSender(event); if (!state) return; state.rect = { x: rect.x | 0, y: rect.y | 0, width: Math.max(0, rect.width | 0), height: Math.max(0, rect.height | 0) }; layout(state); });
ipcMain.on("wheel", (event, input = {}) => {
  const state=forSender(event);
  if(!state||state.overlay||state.recovering||state.htmlFullscreen!==null||!state.active)return;
  const x=Number(input.x),y=Number(input.y),deltaX=Number(input.deltaX),deltaY=Number(input.deltaY),rect=state.rect;
  if(![x,y,deltaX,deltaY].every(Number.isFinite)||x<rect.x||y<rect.y||x>=rect.x+rect.width||y>=rect.y+rect.height)return;
  const page=state.views.get(state.active)?.webContents;
  if(!page||page.isDestroyed())return;
  const dx=Math.max(-4800,Math.min(4800,Math.round(deltaX))),dy=Math.max(-4800,Math.min(4800,Math.round(deltaY)));
  if(!dx&&!dy)return;
  const modifiers=Array.isArray(input.modifiers)?input.modifiers.filter(value=>["shift","control","alt","meta"].includes(value)):[];
  const precise=Math.abs(dx)<80&&Math.abs(dy)<80;
  try{page.focus();page.sendInputEvent({type:"mouseWheel",x:Math.round(x-rect.x),y:Math.round(y-rect.y),deltaX:-dx,deltaY:-dy,wheelTicksX:dx?-Math.sign(dx)*Math.max(1,Math.round(Math.abs(dx)/100)):0,wheelTicksY:dy?-Math.sign(dy)*Math.max(1,Math.round(Math.abs(dy)/100)):0,hasPreciseScrollingDeltas:precise,canScroll:true,modifiers})}catch{}
});
ipcMain.on("overlay", (event, visible) => { const state = forSender(event); if (state) { state.overlay = !!visible; if (state.overlay && state.htmlFullscreen === null) state.ui.focus(); layout(state); } });
ipcMain.on("close", (event, id) => {
  const state = forSender(event), view = state?.views.get(id); if (!view) return;
  state.win.contentView.removeChildView(view); view.webContents.close(); state.views.delete(id); state.loading.delete(id); state.loadRequestIds.delete(id);
  if (state.active === id) state.active = null;
});
ipcMain.on("reload", (event, id) => { const view = forSender(event)?.views.get(id); if (view) view.webContents.reload(); });
ipcMain.on("findInPage", (event, id, query, options = {}) => { const view = forSender(event)?.views.get(id); if (view && String(query || "")) view.webContents.findInPage(String(query).slice(0, 200), { findNext: !!options.findNext, forward: options.forward !== false }); });
ipcMain.on("stopFindInPage", (event, id) => { const view = forSender(event)?.views.get(id); if (view) view.webContents.stopFindInPage("clearSelection"); });
ipcMain.on("print", (event, id) => { const view = forSender(event)?.views.get(id); if (view) view.webContents.print(); });
ipcMain.on("newPrivate", (event) => createPrivateWindow(forSender(event)?.profileId||"default"));
ipcMain.on("openExternal", (event, url) => { if (okUrl(url)) shell.openExternal(url).catch(() => {}); });
ipcMain.on("closeConfirmed", (event, accepted) => { const state = forSender(event); if (!state) return; state.closeDialogPending = false; if (accepted) { state.allowClose = true; state.win.close(); } else state.win.focus(); });
ipcMain.on("permissionReply", (event, id, allowed, remember) => {
  const request = pendingPermissions.get(String(id)); if (!request || request.state !== forSender(event)) return;
  resolvePermission(id, allowed, remember);
});
ipcMain.handle("permissions", (event) => { const state = forSender(event); return state ? [...state.permissions].map(([key, allowed]) => { const [origin, permission] = key.split("|"); return { origin, permission, allowed }; }) : []; });
ipcMain.handle("revokePermission", (event, origin, permission) => { const state = forSender(event); if (!state || typeof origin !== "string" || typeof permission !== "string") return { ok: false }; const prefix = `${origin}|${permission}`; let removed = false; for (const key of state.permissions.keys()) if (key === prefix || key.startsWith(`${prefix}:`)) removed = state.permissions.delete(key) || removed; if (removed && !state.privateMode) saveRememberedPermissions(state.profileId); return { ok: removed }; });
ipcMain.handle("shieldStatus", (event) => shieldStatus(forSender(event)));
ipcMain.handle("shieldUpdate", async (event) => { if (!forSender(event)) return { ok: false }; return updateShieldFilters(); });
ipcMain.handle("clearData", async (event, origin) => {
  const state = forSender(event); if (!state) return { ok: false };
  try {
    const options = origin ? { origin: String(origin) } : undefined;
    await state.session.clearStorageData(options);
    if (!origin) await state.session.clearCache();
    for (const key of state.permissions.keys()) if (!origin || key.startsWith(`${origin}|`)) state.permissions.delete(key);
    if (!state.privateMode) saveRememberedPermissions(state.profileId);
    return { ok: true };
  } catch { return { ok: false }; }
});
ipcMain.on("setTracking", (event, enabled) => { const state = forSender(event); if (state) state.tracking = !!enabled; });
ipcMain.on("setLanguage", (event, language) => { const state = forSender(event); if (!state || typeof language !== "string" || !/^[a-z]{2,3}(?:-[A-Z0-9]{2,3})?$/.test(language)) return; state.language = language; try { state.session.setSpellCheckerLanguages([language, language.split("-")[0]]); } catch {} });
ipcMain.handle("savePage", async (event, id) => {
  const state = forSender(event), view = state?.views.get(id); if (!view) return { ok: false };
  const name = (view.webContents.getTitle() || "page").replace(/[\\/:*?"<>|]+/g, "_").slice(0, 80) + ".html";
  const result = await dialog.showSaveDialog(state.win, { defaultPath: path.join(app.getPath("downloads"), name), filters: [{ name: "Web page", extensions: ["html"] }] });
  if (result.canceled || !result.filePath) return { ok: false, code: "declined" };
  try { await view.webContents.savePage(result.filePath, "HTMLComplete"); return { ok: true }; } catch { return { ok: false, code: "failed" }; }
});
ipcMain.handle("saveFile", async (event, name, data) => {
  const state = forSender(event); if (!state) return { ok: false };
  const safe = path.basename(String(name));
  const result = await dialog.showSaveDialog(state.win, { defaultPath: path.join(app.getPath("downloads"), safe) });
  if (result.canceled || !result.filePath) return { ok: false, code: "declined" };
  try { fs.writeFileSync(result.filePath, typeof data === "string" ? data : Buffer.from(data)); return { ok: true }; } catch { return { ok: false, code: "failed" }; }
});
function validDownloadPath(filePath) { if (typeof filePath !== "string") return null; try { const root = fs.realpathSync(app.getPath("downloads")), candidate = fs.realpathSync(path.resolve(filePath)), relative = path.relative(root, candidate); if (!relative || relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) return null; return fs.statSync(candidate).isFile() ? candidate : null; } catch { return null; } }
ipcMain.on("dlOpen", (event, filePath) => { const target = validDownloadPath(filePath); if (target) shell.openPath(target); });
ipcMain.on("dlShow", (event, filePath) => { const target = validDownloadPath(filePath); if (target) shell.showItemInFolder(target); });
ipcMain.on("dlCancel", (event, id) => { const item = downloadItems.get(String(id)); if (item) item.cancel(); });
ipcMain.handle("performanceMetrics", (event) => { const state=forSender(event); if(!state)return {processes:[]}; const pids=new Set([process.pid]); try{if(!state.ui.isDestroyed())pids.add(state.ui.getOSProcessId())}catch{} for(const view of state.views.values()){try{if(!view.webContents.isDestroyed())pids.add(view.webContents.getOSProcessId())}catch{}} const processes=app.getAppMetrics().filter(metric=>pids.has(metric.pid)).map(metric=>({pid:metric.pid,type:String(metric.type||"Unknown"),name:String(metric.serviceName||metric.name||metric.type||"Process").slice(0,80),cpuPercent:Number.isFinite(metric.cpu?.percentCPUUsage)?metric.cpu.percentCPUUsage:0,workingSetKB:Number.isFinite(metric.memory?.workingSetSize)?metric.memory.workingSetSize:0})); return {processes,measuredAt:Date.now()}; });ipcMain.handle("diagnostics", (event, data = {}) => { const state=forSender(event); if(!state)return {ok:false}; const count=(value,max)=>Math.max(0,Math.min(max,Number.isFinite(Number(value))?Math.floor(Number(value)):0)); const report={app:app.getVersion(),electron:process.versions.electron,chromium:process.versions.chrome,platform:process.platform,arch:process.arch,privateMode:!!state.privateMode,tabs:count(data.tabs,1000),groups:count(data.groups,30),downloads:count(data.downloads,1000),loadingTabs:count(data.loadingTabs,1000),shieldEnabled:data.shieldEnabled===true,error:String(data.error||"").replace(/[\\r\\n\\t]/g," ").slice(0,200),time:new Date().toISOString()}; clipboard.writeText(JSON.stringify(report,null,2)); return {ok:true}; });
ipcMain.handle("info", (event) => ({ name: app.getName(), version: app.getVersion(), electron: process.versions.electron, chrome: process.versions.chrome, platform: process.platform, arch: process.arch, osVersion: process.getSystemVersion?.() || "", locale: app.getLocale(), privateMode: !!forSender(event)?.privateMode }));

ipcMain.handle("vaultStatus", async (event) => {
  if (!forSender(event)) return { available: false, count: 0 };
  try { await vaultQueue; return { available: await vaultEncryptionAvailable(), count: (await readVault(forSender(event)?.profileId||"default")).length }; }
  catch { return { available: false, count: 0 }; }
});
ipcMain.handle("vaultList", async (event) => {
  if (!forSender(event)) return { ok: false, entries: [] };
  try {
    await vaultQueue;
    const entries = await readVault(forSender(event)?.profileId||"default");
    return { ok: true, entries: entries.map(({ id, origin, username, note, createdAt, updatedAt }) => ({ id, origin, username, note, createdAt, updatedAt })) };
  } catch { return { ok: false, entries: [] }; }
});
ipcMain.handle("vaultGet", async (event, id) => {
  if (!forSender(event)) return { ok: false };
  try { await vaultQueue; const entry = (await readVault(forSender(event)?.profileId||"default")).find((item) => item.id === String(id)); return entry ? { ok: true, entry } : { ok: false }; }
  catch { return { ok: false }; }
});
ipcMain.handle("vaultSave", async (event, input = {}) => {
  if (!forSender(event)) return { ok: false, code: "unavailable" };
  let origin;
  try { const parsed = new URL(String(input.origin || "")); if (!linkSafe(parsed.href) || parsed.username || parsed.password) throw new Error(); origin = parsed.origin; }
  catch { return { ok: false, code: "invalid-origin" }; }
  const username = String(input.username || "").slice(0, 1000);
  const password = String(input.password || "").slice(0, 4096);
  const note = String(input.note || "").slice(0, 500);
  if (!password) return { ok: false, code: "empty-password" };
  try {
    const id = await mutateVault((entries) => {
      let entry = input.id ? entries.find((item) => item.id === String(input.id)) : null;
      if (!entry && entries.length >= 2000) throw new Error("vault-full");
      const now = Date.now();
      if (!entry) { entry = { id: randomUUID(), origin, username, password, note, createdAt: now, updatedAt: now }; entries.unshift(entry); }
      else Object.assign(entry, { origin, username, password, note, updatedAt: now });
      return entry.id;
    },forSender(event)?.profileId||'default');
    return { ok: true, id };
  } catch (error) { return { ok: false, code: error.message === "vault-full" ? "vault-full" : error.message === "secure-storage-unavailable" ? "secure-storage-unavailable" : "save-failed" }; }
});
ipcMain.handle("vaultDelete", async (event, id) => {
  if (!forSender(event)) return { ok: false };
  try { await mutateVault((entries) => { const index = entries.findIndex((item) => item.id === String(id)); if (index >= 0) entries.splice(index, 1); },forSender(event)?.profileId||"default"); return { ok: true }; }
  catch { return { ok: false }; }
});
ipcMain.handle("vaultCopy", async (event, id, field) => {
  if (!forSender(event) || !["password", "username"].includes(field)) return { ok: false };
  try {
    await vaultQueue;
    const entry = (await readVault(forSender(event)?.profileId||"default")).find((item) => item.id === String(id));
    if (!entry || !entry[field]) return { ok: false };
    const value = entry[field];
    clipboard.writeText(value);
    vaultClipboardValue = value;
    const generation = ++vaultClipboardGeneration;
    setTimeout(() => { try { if (generation === vaultClipboardGeneration && vaultClipboardValue === value && clipboard.readText() === value) clipboard.clear(); if (generation === vaultClipboardGeneration) vaultClipboardValue = null; } catch {} }, 30000).unref?.();
    return { ok: true };
  } catch { return { ok: false }; }
});
ipcMain.handle("vaultFill", async (event, tabId, id) => {
  const state = forSender(event), view = state?.views.get(tabId);
  if (!state || !view || String(state.active) !== String(tabId)) return { ok: false, code: "tab-inactive" };
  try {
    await vaultQueue;
    const entry = (await readVault(forSender(event)?.profileId||"default")).find((item) => item.id === String(id));
    if (!entry) return { ok: false, code: "missing-entry" };
    const current = new URL(view.webContents.getURL());
    const loopback = current.hostname === "localhost" || current.hostname === "127.0.0.1" || current.hostname === "[::1]";
    if (current.origin !== entry.origin) return { ok: false, code: "wrong-site" };
    if (current.protocol !== "https:" && !loopback) return { ok: false, code: "insecure-site" };
    const values = JSON.stringify({ username: entry.username, password: entry.password });
    const result = await view.webContents.executeJavaScript(`(()=>{const c=${values};const inputs=[...document.querySelectorAll('input')].filter(e=>!e.disabled&&e.getClientRects().length);const p=inputs.find(e=>e.type==='password');if(!p)return false;const pool=inputs.filter(e=>e!==p&&['text','email','tel'].includes(e.type));const form=p.form;const candidates=form?pool.filter(e=>e.form===form):pool;const u=candidates.find(e=>/user|login|email|account/i.test([e.name,e.id,e.autocomplete,e.getAttribute('aria-label')].join(' ')))||candidates[0];const set=(e,v)=>{const d=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value');d.set.call(e,v);e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}))};if(u&&c.username)set(u,c.username);set(p,c.password);return true})()`, true);
    return { ok: !!result, code: result ? "filled" : "no-password-field" };
  } catch { return { ok: false, code: "fill-failed" }; }
});

app.on("web-contents-created", (_event, wc) => wc.on("will-attach-webview", (event) => event.preventDefault()));
app.on("second-instance", (_event, argv) => {
  if (mainState?.win && !mainState.win.isDestroyed()) { if (mainState.win.isMinimized()) mainState.win.restore(); mainState.win.focus(); }
  argv.filter(okUrl).forEach((url) => mainState ? send(mainState, "newtab", { url }) : pendingUrls.push(url));
});
app.on("open-url", (event, url) => { event.preventDefault(); if (mainState && !mainState.ui.isLoading()) send(mainState, "newtab", { url }); else pendingUrls.push(url); });
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("before-quit", () => { persistShieldStatsNow(); try { if (vaultClipboardValue && clipboard.readText() === vaultClipboardValue) clipboard.clear(); } catch {} vaultClipboardValue = null; });
app.on("activate", () => { if (!BaseWindow.getAllWindows().length) mainState = createWindow(); });
app.whenReady().then(async () => {
  loadProfileRegistry();
  permissionsForProfile("default");
  await loadShieldStats();
  if (process.platform === "darwin") Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: "appMenu" }, { role: "editMenu" }, { role: "windowMenu" }]));
  await readShieldEngines();
  mainState = createWindow();
  initializeAutoUpdater();
  process.argv.filter(okUrl).forEach((url) => pendingUrls.push(url));
  setTimeout(async () => { try { if (!shieldUpdatedAt || Date.now() - Date.parse(shieldUpdatedAt) > 24 * 60 * 60 * 1000) await updateShieldFilters(); } catch {} }, 12000).unref?.();
});
