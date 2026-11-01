let findContextId = null;
let findCountText = "";
let findLastQuery = "";

function findBarHTML() {
  return `<div id="findbar" class="g ui"><div class="find-input"><span>${ic("srch")}</span><input id="find-query" type="search" placeholder="${t("findInPage")}" autocomplete="off"><span id="find-count" class="muted">${esc(findCountText)}</span></div><button class="ib" data-a="findprev" title="${t("findPrevious")}">${ic("chev")}</button><button class="ib" data-a="findnext" title="${t("findNext")}">${ic("chev")}</button><button class="ib" data-a="findclose" title="${t("done")}">${ic("x")}</button></div>`;
}

function openFindBar() {
  const tab = T();
  if (!A || !tab || tab.page || tab.i < 0) return toast(t("findUnavailable"));
  findContextId = tab.id;
  findCountText = "";
  findLastQuery = "";
  document.querySelector("#findbar")?.remove();
  document.body.insertAdjacentHTML("beforeend", findBarHTML());
  A.overlay(true);
  const input = document.querySelector("#find-query");
  input.focus();
  input.select();
}

function closeFindBar() {
  if (findContextId !== null && A) A.stopFindInPage(findContextId);
  findContextId = null;
  findLastQuery = "";
  document.querySelector("#findbar")?.remove();
  if (A) A.overlay(false);
}

function searchInPage(direction = "next") {
  const input = document.querySelector("#find-query");
  if (!input || findContextId === null || !A) return;
  const query = input.value.slice(0, 200);
  findCountText = query ? "…" : "";
  document.querySelector("#find-count").textContent = findCountText;
  if (query) { const findNext = query === findLastQuery; findLastQuery = query; A.findInPage(findContextId, query, { findNext, forward: direction !== "previous" }); }
  else A.stopFindInPage(findContextId);
}

function onFindResult(data) {
  if (data.id !== findContextId || !document.querySelector("#findbar")) return;
  const input = document.querySelector("#find-query"), count = document.querySelector("#find-count");
  if (!input || !count || !input.value) { if (count) count.textContent = ""; return; }
  count.textContent = data.result.matches ? `${Math.min(data.result.activeMatchOrdinal, data.result.matches)} / ${data.result.matches}` : "0 / 0";
}

document.addEventListener("input", (event) => { if (event.target.id === "find-query") searchInPage("next"); });
document.addEventListener("keydown", (event) => {
  if (!document.querySelector("#findbar")) return;
  if (event.key === "Escape") { event.preventDefault(); closeFindBar(); }
  else if (event.key === "Enter") { event.preventDefault(); searchInPage(event.shiftKey ? "previous" : "next"); }
});
