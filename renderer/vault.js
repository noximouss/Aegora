let vaultItems = [];
let vaultLoaded = false;
let vaultLoading = false;
let vaultAvailable = false;
let vaultQuery = "";

function currentVaultUrl() {
  const tab = T();
  return tab && tab.i >= 0 && tab.h[tab.i] && !tab.h[tab.i].ext ? tab.h[tab.i].u : "";
}

function currentVaultOrigin() {
  try { return new URL(currentVaultUrl()).origin; } catch { return ""; }
}

function canFillVaultEntry(entry) {
  try {
    const url = new URL(currentVaultUrl());
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    return url.origin === entry.origin && (url.protocol === "https:" || loopback);
  } catch { return false; }
}

function vaultRows() {
  const query = vaultQuery.trim().toLowerCase();
  const rows = vaultItems.filter((entry) => !query || `${entry.origin} ${entry.username} ${entry.note || ""}`.toLowerCase().includes(query));
  if (!rows.length) return `<div class="pw-empty"><span class="pw-empty-icon">${ic("lock")}</span><b>${t("pwEmpty")}</b><span class="muted">${t("pwSecure")}</span></div>`;
  return rows.map((entry) => `<article class="pw-card g"><div class="pw-brand"><span class="pw-favicon">${ic("globe")}</span><div class="pw-info"><b>${esc(entry.origin)}</b><span class="muted">${esc(entry.username || "—")}${entry.note ? ` · ${esc(entry.note)}` : ""}</span></div></div><div class="pw-actions"><button class="pill" data-a="fillpw" data-id="${esc(entry.id)}" ${canFillVaultEntry(entry) ? "" : "disabled"}>${t("pwFill")}</button><button class="pill soft" data-a="copypw" data-id="${esc(entry.id)}" data-k="password" title="${t("pwCopy")}">${ic("lock")}</button><button class="pill soft" data-a="copypw" data-id="${esc(entry.id)}" data-k="username" title="${t("pwUserCopied")}">${ic("info")}</button><button class="pill soft" data-a="editpw" data-id="${esc(entry.id)}">${t("pwEdit")}</button><button class="pill soft" data-a="delpw" data-id="${esc(entry.id)}">${t("pwDelete")}</button></div></article>`).join("");
}

function vaultHTML() {
  if (!vaultAvailable && vaultLoaded) return `<div class="lib pw-page"><div class="pw-heading"><div><h2>${t("passwords")}</h2><p class="muted">${t("pwUnavailable")}</p></div></div></div>`;
  return `<div class="lib pw-page"><div class="pw-heading"><div><h2>${t("passwords")}</h2><p class="muted">${t("pwSecure")}</p></div><button class="pill" data-a="addpw">${ic("plus")}${t("pwAdd")}</button></div><div class="pw-toolbar"><label class="pw-search">${ic("srch")}<input id="pw-search" value="${esc(vaultQuery)}" placeholder="${t("pwSearch")}" autocomplete="off"></label><span class="pw-count">${vaultLoading ? `<span class="spinner"></span>` : `${vaultItems.length} / 2000`}</span></div><div id="pw-list" class="pw-list">${vaultRows()}</div></div>`;
}

async function loadVault(force = false) {
  if (!A || vaultLoading || (vaultLoaded && !force)) return;
  vaultLoading = true;
  try {
    const status = await A.vaultStatus();
    vaultAvailable = !!status.available;
    if (vaultAvailable) {
      const result = await A.vaultList();
      vaultItems = result.ok ? result.entries : [];
      vaultAvailable = !!result.ok;
    } else vaultItems = [];
    vaultLoaded = true;
  } catch { vaultAvailable = false; vaultItems = []; vaultLoaded = true; }
  finally {
    vaultLoading = false;
    if (T()?.page === "passwords") render();
  }
}

function openPasswords() {
  vaultQuery = "";
  vaultLoaded = false;
  vaultItems = [];
  T().page = "passwords";
  render();
}

function askVaultEntry(entry = {}) {
  const origin = entry.origin || currentVaultOrigin();
  const d = document.createElement("div");
  d.className = "dlg ui";
  d.innerHTML = `<form class="g pw-form"><div class="pw-form-title"><span class="pw-favicon">${ic("lock")}</span><div><b>${entry.id ? t("pwEdit") : t("pwAdd")}</b><small class="muted">${t("pwSecure")}</small></div></div><label>${t("pwSite")}<input name="origin" type="url" required value="${esc(origin)}" placeholder="https://example.com" autocomplete="url"></label><label>${t("pwUser")}<input name="username" maxlength="1000" value="${esc(entry.username || "")}" autocomplete="username"></label><label>${t("pwPass")}<div class="pw-pass-row"><input name="password" type="password" maxlength="4096" required value="${esc(entry.password || "")}" autocomplete="new-password"><button class="pill soft" type="button" data-a="genpw">${t("pwGenerator")}</button></div></label><label>${t("pwNote")}<input name="note" maxlength="500" value="${esc(entry.note || "")}" autocomplete="off"></label><div class="pw-form-actions"><button class="pill soft" type="button" data-vault-cancel>${t("pwCancel")}</button><button class="pill" type="submit">${t("pwSave")}</button></div></form>`;
  document.body.appendChild(d);
  const form = d.querySelector("form");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const result = await A.vaultSave({ id: entry.id, origin: form.elements.origin.value.trim(), username: form.elements.username.value, password: form.elements.password.value, note: form.elements.note.value });
    if (!result.ok) { toast(result.code === "secure-storage-unavailable" ? t("pwUnavailable") : t("pwBadStore")); return; }
    d.remove();
    vaultLoaded = false;
    toast(t("pwSaved"));
    await loadVault(true);
  });
  d.querySelector("[data-vault-cancel]").onclick = () => d.remove();
  form.elements.origin.focus();
}

async function editVaultEntry(id) {
  const result = await A.vaultGet(id);
  if (result.ok) askVaultEntry(result.entry);
  else toast(t("pwBadStore"));
}

function askVaultDelete(id) {
  const entry = vaultItems.find((item) => item.id === id);
  if (!entry) return;
  const d = document.createElement("div");
  d.className = "dlg ui";
  d.innerHTML = `<form class="g"><b>${t("pwConfirm")}</b><span class="muted">${esc(entry.origin)} · ${esc(entry.username || "—")}</span><div class="pw-form-actions"><button class="pill soft" type="button" data-vault-cancel>${t("pwCancel")}</button><button class="pill" type="submit">${t("pwDelete")}</button></div></form>`;
  document.body.appendChild(d);
  d.querySelector("[data-vault-cancel]").onclick = () => d.remove();
  d.querySelector("form").onsubmit = async (event) => {
    event.preventDefault();
    const result = await A.vaultDelete(id);
    d.remove();
    if (!result.ok) return toast(t("pwBadStore"));
    vaultItems = vaultItems.filter((item) => item.id !== id);
    render();
    toast(t("pwDeleted"));
  };
}

async function copyVaultField(id, field) {
  const result = await A.vaultCopy(id, field);
  if (result.ok) toast(field === "password" ? t("pwCopied") : t("pwUserCopied"));
  else toast(t("pwBadStore"));
}

async function fillVaultEntry(id) {
  const tab = T();
  if (!tab || tab.i < 0) return toast(t("pwWrongSite"));
  const entry = vaultItems.find((item) => item.id === id);
  if (!entry || !canFillVaultEntry(entry)) {
    const url = currentVaultUrl();
    return toast(url.startsWith("http:") ? t("pwInsecure") : t("pwWrongSite"));
  }
  tab.page = null;
  render();
  const result = await A.vaultFill(tab.id, id);
  toast(result.ok ? t("pwFillOk") : result.code === "insecure-site" ? t("pwInsecure") : result.code === "no-password-field" ? t("pwNoField") : t("pwWrongSite"));
}

function secureRandomIndex(length) {
  const limit = 256 - (256 % length);
  const bytes = new Uint8Array(1);
  do { crypto.getRandomValues(bytes); } while (bytes[0] >= limit);
  return bytes[0] % length;
}

function generateVaultPassword() {
  const form = document.querySelector(".pw-form");
  if (!form) return;
  const groups = ["ABCDEFGHJKLMNPQRSTUVWXYZ", "abcdefghijkmnopqrstuvwxyz", "23456789", "!@#$%^&*_-+=?"];
  const chars = groups.map((group) => group[secureRandomIndex(group.length)]);
  const alphabet = groups.join("");
  while (chars.length < 22) chars.push(alphabet[secureRandomIndex(alphabet.length)]);
  for (let i = chars.length - 1; i > 0; i--) { const j = secureRandomIndex(i + 1); [chars[i], chars[j]] = [chars[j], chars[i]]; }
  form.elements.password.value = chars.join("");
  form.elements.password.focus();
  form.elements.password.select();
  toast(t("pwGenerated"));
}

document.addEventListener("input", (event) => {
  if (event.target.id !== "pw-search") return;
  vaultQuery = event.target.value;
  const list = document.querySelector("#pw-list");
  if (list) list.innerHTML = vaultRows();
});
