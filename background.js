const CRM_URL = 'https://autotext-psi.vercel.app/website-opportunities';
let state = { items: [], index: 0, tabId: null, crmTabId: null, waiting: false };
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
  if (!clean.length) return { error: 'No unreviewed opportunities with valid website URLs.' };
  await restored;
  state.items = clean;
  state.index = Math.max(0, clean.findIndex(item => item.id === startId));
  state.crmTabId = senderTabId;
  state.waiting = false;
  await persist();
  const url = clean[state.index].websiteUrl;
  if (state.tabId) {
    try { await chrome.tabs.update(state.tabId, { url, active: true }); return { ok: true, total: clean.length }; } catch {}
  }
  const tab = await chrome.tabs.create({ url, active: true });
  state.tabId = tab.id;
  await persist();
  return { ok: true, total: clean.length };
};
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  (async () => {
    await restored;
    if (message.type === 'AO_INSTALL_CRM_PAGE') { if (!sender.tab?.id || !sender.tab.url?.startsWith('https://autotext-psi.vercel.app/')) return { error: 'Not the AnthonyOS CRM.' }; await chrome.scripting.executeScript({ target: { tabId: sender.tab.id }, files: ['crm-page.js'], world: 'MAIN' }); return { ok: true }; }
    if (message.type === 'AO_VIEW_START') return openViewer(sender.tab?.id, message.items, message.startId);
    if (message.type === 'AO_VIEW_MOVE') { await move(message.delta > 0 ? 1 : -1); return { ok: true }; }
    if (message.type === 'AO_VIEW_GET') return { ok: true, active: sender.tab?.id === state.tabId, item: current(), index: state.index, total: state.items.length, waiting: state.waiting };
    if (message.type === 'AO_VIEW_REVIEW') {
      if ((sender.tab?.id !== state.tabId && !sender.url?.startsWith(chrome.runtime.getURL('popup.html'))) || state.waiting) return { error: 'No active viewer or save already in progress.' };
      if (!state.crmTabId) return { error: 'CRM tab unavailable. Open the CRM to resume.' };
      const item = current();
      state.waiting = true; await emit();
      try {
        const result = await chrome.tabs.sendMessage(state.crmTabId, { type: 'AO_CRM_REVIEW', id: item.id, tag: message.tag });
        if (!result?.ok) throw new Error(result?.error || 'Could not save review');
        state.items.splice(state.index, 1);
        if (!state.items.length) state.index = 0;
        else state.index %= state.items.length;
        await persist();
        const nextUrl = current()?.websiteUrl || CRM_URL;
        await chrome.tabs.update(state.tabId, { url: nextUrl });
        return { ok: true };
      } catch (error) { return { error: String(error?.message || error) }; }
      finally { state.waiting = false; await persist(); await emit(); }
    }
    return { error: 'Unknown message' };
  })().then(reply).catch(e => reply({ error: String(e.message ?? e) }));
  return true;
});
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (tabId === state.tabId && changeInfo.status === 'complete') emit();
});
chrome.tabs.onRemoved.addListener(tabId => {
  if (tabId === state.tabId) state.tabId = null;
  if (tabId === state.crmTabId) state.crmTabId = null;
  persist();
});
