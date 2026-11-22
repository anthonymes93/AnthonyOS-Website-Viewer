const CRM_URL = 'https://autotext-psi.vercel.app/website-opportunities';
let state = { items: [], index: 0, tabId: null, crmTabId: null, controlWindowId: null, waiting: false };
// Durable write-ahead queue. Save locally before advancing the website.
let flushPromise = null;
const pendingReady = chrome.storage.local.get('pendingReviews').then(v => Array.isArray(v.pendingReviews) ? v.pendingReviews : []);
async function flushReviews() {
  if (flushPromise) return flushPromise;
  flushPromise = (async () => {
    const pending = await pendingReady;
    while (pending.length) {
      const job = pending[0];
      let tabId = state.crmTabId;
      try {
        if (!tabId || !(await chrome.tabs.get(tabId).catch(() => null))) {
          const tabs = await chrome.tabs.query({url:'https://autotext-psi.vercel.app/*'});
          tabId = tabs.find(t => t.url?.includes('/website-opportunities'))?.id;
        }
        if (!tabId) throw Error('Open Website Opportunities in AnthonyOS to resume saving.');
        const response = await chrome.tabs.sendMessage(tabId, {type:'AO_CRM_REVIEW', id:job.id, tag:job.tag});
        if (!response?.ok) throw Error(response?.error || 'Firestore save failed');
        pending.shift();
        await chrome.storage.local.set({pendingReviews:pending});
        reviewError = '';
      } catch (e) {
        reviewError = 'Unsaved tags (' + pending.length + '): ' + (e.message || e);
        break;
      }
    }
  })().finally(() => { flushPromise = null; });
  return flushPromise;
}
chrome.alarms.onAlarm.addListener(a => { if(a.name === 'review-retry') void flushReviews(); });
chrome.alarms.create('review-retry', {periodInMinutes:1});
void restoredAfterStartup();
async function restoredAfterStartup() {
  await pendingReady;
  await new Promise(resolve => setTimeout(resolve, 1000));
  await flushReviews();
}
let reviewError = '';
let hasMorePages = true;
let pageLoading = null;
async function prefetchPage() {
  if (!hasMorePages || pageLoading || !state.crmTabId) return pageLoading;
  pageLoading = (async () => {
    const result = await chrome.tabs.sendMessage(state.crmTabId, { type: 'AO_CRM_PAGE' });
    if (result?.error) throw new Error(result.error);
    const added = (result?.items ?? []).filter(x => x.id && validUrl(x.websiteUrl));
    const ids = new Set(state.items.map(x => x.id));
    for (const item of added) if (!ids.has(item.id)) { state.items.push(item); ids.add(item.id); }
    hasMorePages = !!result?.hasMore;
    await persist();
  })().catch(error => { reviewError = 'Could not load more websites: ' + error.message; }).finally(() => { pageLoading = null; });
  return pageLoading;
}
function maybePrefetch() { if (state.items.length - state.index <= 5) void prefetchPage(); }
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
  if (url) { void persist(); void chrome.tabs.update(state.tabId, { url }).catch(error => { reviewError = 'Navigation failed: ' + error.message; }); maybePrefetch(); }
};
const openViewer = async (senderTabId, items, startId = null, hasMore = false) => {
  const clean = (items ?? []).filter(x => x.id && validUrl(x.websiteUrl)).map(x => ({
    id: x.id, title: String(x.title ?? ''), websiteUrl: validUrl(x.websiteUrl),
    listingUrl: validUrl(x.listingUrl ?? ''), tags: Array.isArray(x.tags) ? x.tags : [],
  }));
  if (!clean.length) return { error: 'No opportunities with valid website URLs.' };
  await restored;
  state.items = clean;
  hasMorePages = !!hasMore;
  state.index = Math.max(0, clean.findIndex(item => item.id === startId));
  state.crmTabId = senderTabId;
  state.waiting = false;
  await persist();
  const url = clean[state.index].websiteUrl;
  if (state.tabId) {
    try { await chrome.tabs.update(state.tabId, { url, active: true }); await openControls(); maybePrefetch(); return { ok: true, total: clean.length }; } catch {}
  }
  const tab = await chrome.tabs.create({ url, active: true });
  state.tabId = tab.id;
  await persist();
  await openControls();
  maybePrefetch();
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
    if (message.type === 'AO_VIEW_START') return openViewer(sender.tab?.id, message.items, message.startId, message.hasMore);
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
    if (message.type === 'AO_VIEW_GET') { const pending = await pendingReady; return { ok: true, active: sender.tab?.id === state.tabId, item: current(), index: state.index, total: state.items.length, waiting: state.waiting, reviewError, pendingCount: pending.length }; }
    if (message.type === 'AO_VIEW_REVIEW') {
      if (sender.tab?.id !== state.tabId && !sender.url?.startsWith(chrome.runtime.getURL('popup.html'))) return { error: 'No active viewer.' };
      if (!state.crmTabId) return { error: 'CRM tab unavailable. Open the CRM to resume.' };
      const item = current();
      if (!item) return { error: 'No website selected.' };
      const tag = message.tag || '';
      const pending = await pendingReady;
      pending.push({id:item.id,tag,createdAt:Date.now()});
      // Do not navigate until the review is safely written to local storage.
      await chrome.storage.local.set({pendingReviews:pending});
      item.tags = tag ? [tag] : [];
      state.index = (state.index + 1) % state.items.length;
      const nextUrl = current()?.websiteUrl || CRM_URL;
      void persist();
      void chrome.tabs.update(state.tabId, {url:nextUrl}).catch(e => {reviewError = 'Navigation failed: ' + e.message;});
      maybePrefetch();
      void flushReviews();
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
