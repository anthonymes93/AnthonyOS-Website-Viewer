const CRM_URL = 'https://autotext-psi.vercel.app/website-opportunities';
let state = { items: [], index: 0, tabId: null, crmTabId: null, controlWindowId: null, waiting: false };\nlet reviewQueue = Promise.resolve();\nlet reviewError = '';
async function persist() { await chrome.storage.session.set({ viewerState: state }); }
const restored = chrome.storage.session.get('viewerState').then(data => { if (data.viewerState) state = data.viewerState; }).catch(() => {});

const validUrl = raw => {
  try { const u = new URL(/^https?:\/\//i.test(raw) ? raw : 'https://' + raw); return /^https?:$/.test(u.protocol) ? u.href : null; }
  catch { return null; }
};
const current = () => state.items[state.index] ?? null;
const emit = async () => {
  await restored;
  if (!state.tabId) return;
  try { await chrome.tabs.sendMessage(state.tabId, { type: 'AO_VIEW_STATE', item: current(), index: state.index, total: state.items.length, waiting: state.waiting }); } catch {}
};
const move = async delta => {
  await restored;
  if (!state.items.length || state.tabId === null) return;
  state.index = (state.index + delta + state.items.length) % state.items.length;
  const url = validUrl(current()?.websiteUrl ?? '');
  if (url) { await persist(); await chrome.tabs.update(state.tabId, { url }); }
};
const openViewer = async (senderTabId, items, startId = null) => {
  const clean = (items ?? []).filter(x => x.id && validUrl(x.websiteUrl)).map(x => ({
    id: x.id, title: String(x.title ?? ''), websiteUrl: validUrl(x.websiteUrl),
    listingUrl: validUrl(x.listingUrl ?? ''), tags: Array.isArray(x.tags) ? x.tags : [],
  }));
  if (!clean.length) return { error: 'No opportunities with valid website URLs.' };
  await restored;
  state.items = clean;
  state.index = Math.max(0, clean.findIndex(item => item.id === startId));
  state.crmTabId = senderTabId;
  state.waiting = false;
  await persist();
  const url = clean[state.index].websiteUrl;
  if (state.tabId) {
    try { await chrome.tabs.update(state.tabId, { url, active: true }); await openControls(); return { ok: true, total: clean.length }; } catch {}
  }
  const tab = await chrome.tabs.create({ url, active: true });
  state.tabId = tab.id;
  await persist();
  await openControls();
  return { ok: true, total: clean.length };
};
async function openControls() {
  if (state.controlWindowId) {
    try { await chrome.windows.get(state.controlWindowId); await chrome.windows.update(state.controlWindowId, { focused: true }); return; } catch { state.controlWindowId = null; }
  }
  const w = await chrome.windows.create({ url: chrome.runtime.getURL('popup.html?window=1'), type: 'popup', width: 390, height: 470, focused: true });
  state.controlWindowId = w.id;
  await persist();
}
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  (async () => {
    await restored;
    if (message.type === 'AO_INSTALL_CRM_PAGE') { if (!sender.tab?.id || !sender.tab.url?.startsWith('https://autotext-psi.vercel.app/')) return { error: 'Not the AnthonyOS CRM.' }; await chrome.scripting.executeScript({ target: { tabId: sender.tab.id }, files: ['crm-page.js'], world: 'MAIN' }); return { ok: true }; }
    if (message.type === 'AO_VIEW_START') return openViewer(sender.tab?.id, message.items, message.startId);
    if (message.type === 'AO_VIEW_SYNC_STATUS') return { active: sender.tab?.id === state.crmTabId && !!state.tabId };
    if (message.type === 'AO_VIEW_SYNC') {
      if (sender.tab?.id !== state.crmTabId || !state.tabId || state.waiting) return { ok: false };
      const clean = (message.items ?? []).filter(x => x.id && validUrl(x.websiteUrl)).map(x => ({
        id: x.id, title: String(x.title ?? ''), websiteUrl: validUrl(x.websiteUrl),
        listingUrl: validUrl(x.listingUrl ?? ''), tags: Array.isArray(x.tags) ? x.tags : [],
      }));
      // A background CRM refresh must never change the website being viewed.
      // Keep the current item even if the refreshed list temporarily omits it.
      const previous = current();
      if (previous && !clean.some(x => x.id === previous.id)) clean.push(previous);
      state.items = clean;
      state.index = previous ? clean.findIndex(x => x.id === previous.id) : 0;
      await persist();
      await emit();
      return { ok: true, total: clean.length };
    }
    if (message.type === 'AO_VIEW_MOVE') { await move(message.delta > 0 ? 1 : -1); return { ok: true }; }
    if (message.type === 'AO_VIEW_GET') return { ok: true, active: sender.tab?.id === state.tabId, item: current(), index: state.index, total: state.items.length, waiting: state.waiting, reviewError };
    if (message.type === 'AO_VIEW_REVIEW') {
      if (sender.tab?.id !== state.tabId && !sender.url?.startsWith(chrome.runtime.getURL('popup.html'))) return { error: 'No active viewer.' };
      if (!state.crmTabId) return { error: 'CRM tab unavailable. Open the CRM to resume.' };
      const item = current();
      if (!item) return { error: 'No website selected.' };
      const tag = message.tag || '';
      const crmTabId = state.crmTabId;
      const previousTags = [...item.tags];
      item.tags = tag ? [tag] : [];
      state.index = (state.index + 1) % state.items.length;
      // Navigate immediately; Firestore saving happens asynchronously in order.
      const nextUrl = current()?.websiteUrl || CRM_URL;
      const navigation = chrome.tabs.update(state.tabId, { url: nextUrl });
      void persist();
      reviewError = '';
      reviewQueue = reviewQueue.catch(() => {}).then(async () => {
        try {
          const result = await chrome.tabs.sendMessage(crmTabId, { type: 'AO_CRM_REVIEW', id: item.id, tag });
          if (!result?.ok) throw new Error(result?.error || 'Could not save review');
        } catch (error) {
          item.tags = previousTags;
          reviewError = `Could not save review for ${item.title || item.websiteUrl}: ${String(error?.message || error)}`;
          await persist();
        }
      });
      await navigation;
      return { ok: true };
    }
    return { error: 'Unknown message' };
  })().then(reply).catch(e => reply({ error: String(e.message ?? e) }));
  return true;
});
chrome.tabs.onRemoved.addListener(tabId => {
  if (tabId === state.tabId) state.tabId = null;
  if (tabId === state.crmTabId) state.crmTabId = null;
  persist();
});
chrome.windows.onRemoved.addListener(windowId => {
  if (windowId === state.controlWindowId) { state.controlWindowId = null; persist(); }
});
