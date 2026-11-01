(function (root) {
  "use strict";
  const COLORS = Object.freeze({ blue: "#5271FF", purple: "#9A6BFF", green: "#35B779", orange: "#F39A3B", pink: "#E96591", cyan: "#32A8C7" });
  function normalizeGroups(value) {
    if (!Array.isArray(value)) return [];
    const seen = new Set();
    return value.slice(0, 30).flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const id = String(item.id || "").slice(0, 80), name = String(item.name || "").trim().slice(0, 40);
      if (!id || !name || seen.has(id)) return [];
      seen.add(id);
      return [{ id, name, color: Object.hasOwn(COLORS, item.color) ? item.color : "blue", collapsed: item.collapsed === true }];
    });
  }
  function normalizeMembership(tabs, groups) {
    const valid = new Set(normalizeGroups(groups).map((group) => group.id));
    return (Array.isArray(tabs) ? tabs : []).map((tab) => ({ ...tab, groupId: valid.has(String(tab?.groupId || "")) ? String(tab.groupId) : null }));
  }
  function addGroup(groups, name, color, id) {
    const cleanName = String(name || "").trim().slice(0, 40), normalized = normalizeGroups(groups);
    if (!cleanName || normalized.length >= 30) return { groups: normalized, group: null };
    const group = { id: String(id || `group-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`), name: cleanName, color: Object.hasOwn(COLORS, color) ? color : "blue", collapsed: false };
    return { groups: [...normalized, group], group };
  }
  function assignTab(tabs, tabId, groupId, groups) {
    const valid = new Set(normalizeGroups(groups).map((group) => group.id)), target = groupId && valid.has(String(groupId)) ? String(groupId) : null;
    let found = false;
    const next = (Array.isArray(tabs) ? tabs : []).map((tab) => { if (String(tab.id) !== String(tabId)) return tab; found = true; return { ...tab, groupId: target }; });
    return found ? next : null;
  }
  function removeGroup(groups, tabs, groupId) {
    return { groups: normalizeGroups(groups).filter((group) => group.id !== String(groupId)), tabs: (Array.isArray(tabs) ? tabs : []).map((tab) => ({ ...tab, groupId: String(tab.groupId || "") === String(groupId) ? null : (tab.groupId || null) })) };
  }
  function closeGroupTabs(tabs, groupId) { return (Array.isArray(tabs) ? tabs : []).filter((tab) => String(tab.groupId || "") !== String(groupId)); }
  const api = { COLORS, normalizeGroups, normalizeMembership, addGroup, assignTab, removeGroup, closeGroupTabs };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.AegoraTabGroups = api;
})(typeof window !== "undefined" ? window : globalThis);
