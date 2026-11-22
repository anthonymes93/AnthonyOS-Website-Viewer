(() => {
  if (!location.pathname.startsWith('/website-opportunities')) return;
  if (window.__anthonyViewerBridge) return;
  window.__anthonyViewerBridge = true;
  const CHANNEL = 'anthonyos-website-viewer';
  const REQUEST = 'AO_BRIDGE_REQUEST', RESPONSE = 'AO_BRIDGE_RESPONSE';
  // Messages are accepted only from this extension's isolated content script.
  const bridgeReady = chrome.runtime.sendMessage({ type: 'AO_INSTALL_CRM_PAGE' })
    .then(result => { if (!result?.ok) throw new Error(result?.error || 'Could not initialize CRM bridge'); });
  const send = payload => new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    const timeout = setTimeout(() => { window.removeEventListener('message', listener); reject(new Error('CRM did not respond. Refresh its tab.')); }, 12000);
    function listener(event) {
      if (event.source !== window || event.data?.channel !== CHANNEL || event.data?.kind !== RESPONSE || event.data?.id !== id) return;
      window.removeEventListener('message', listener); clearTimeout(timeout);
      if (event.data.error) reject(new Error(event.data.error)); else resolve(event.data.payload);
    }
    window.addEventListener('message', listener);
    window.postMessage({ channel: CHANNEL, kind: REQUEST, id, payload }, location.origin);
  });
  // Keep the active viewer aligned with Firestore updates reflected in the CRM.
  let syncing = false;
  setInterval(async () => {
    if (syncing || location.pathname !== '/website-opportunities') return;
    syncing = true;
    try {
      await bridgeReady;
      const status = await chrome.runtime.sendMessage({ type: 'AO_VIEW_SYNC_STATUS' });
      if (status?.active) {
        const items = await send({ action: 'list' });
        await chrome.runtime.sendMessage({ type: 'AO_VIEW_SYNC', items });
      }
    } catch (error) { console.warn('Website Viewer sync:', error); }
    finally { syncing = false; }
  }, 5000);
  // Replace the CRM's regular Open Website action when the extension is installed.
  // Capture before React's click handler so it does not create an extra tab.
  document.addEventListener('click', async event => {
    const target = event.target instanceof Element ? event.target : null;
    if (location.pathname !== '/website-opportunities') return;
    const openButton = target?.closest('.wo-card .wo-action-btn--primary');
    if (!openButton) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    const card = openButton.closest('.wo-card');
    const selectedUrl = card?.querySelector('.wo-url-value--highlight')?.textContent?.trim() ?? '';
    const originalText = openButton.textContent;
    openButton.disabled = true;
    openButton.textContent = 'Opening Viewer…';
    try {
      await bridgeReady;
      const items = await send({ action: 'list' });
      const normalize = raw => { try { const text = String(raw); const url = new URL(text.startsWith('http://') || text.startsWith('https://') ? text : 'https://' + text); return url.hostname.startsWith('www.') ? url.hostname.slice(4) : url.hostname; } catch { return ''; } };
      const selected = items.find(item => normalize(item.websiteUrl) === normalize(selectedUrl));
      const result = await chrome.runtime.sendMessage({ type: 'AO_VIEW_START', items, startId: selected?.id });
      if (!result?.ok) throw new Error(result?.error || 'Viewer unavailable');
    } catch (error) {
      openButton.textContent = 'Viewer error — try Launch Viewer';
      console.error('AnthonyOS Website Viewer:', error);
      return;
    } finally {
      openButton.disabled = false;
    }
    openButton.textContent = originalText;
  }, true);
  const button = document.createElement('button');
  button.textContent = 'Launch Website Viewer';
  Object.assign(button.style, { position:'fixed',bottom:'24px',right:'24px',zIndex:2147483647,padding:'14px 18px',background:'#6d5dfc',border:'1px solid #988dff',borderRadius:'12px',color:'#fff',font:'600 14px system-ui',cursor:'pointer',boxShadow:'0 8px 30px #0009' });
  button.addEventListener('click', async () => {
    button.disabled = true; button.textContent = 'Loading opportunities…';
    try {
      await bridgeReady;
      const data = await send({ action:'list' });
      const result = await chrome.runtime.sendMessage({ type:'AO_VIEW_START', items:data });
      if (result?.error) throw new Error(result.error);
      button.textContent = 'Viewer opened (' + result.total + ')';
    } catch(e) { button.textContent = 'Viewer error: ' + e.message; }
    finally { setTimeout(()=>{button.disabled=false;button.textContent='Launch Website Viewer';},3500); }
  });
  document.body.appendChild(button);
  // AnthonyOS uses client-side routing: content scripts survive navigation.
  // Keep the launcher hidden everywhere except the Website Opportunities page.
  let lastPath = '';
  const syncLauncher = () => {
    if (location.pathname === lastPath) return;
    lastPath = location.pathname;
    button.hidden = lastPath !== '/website-opportunities';
    button.style.display = button.hidden ? 'none' : 'block';
  };
  syncLauncher();
  window.addEventListener('popstate', syncLauncher);
  window.addEventListener('hashchange', syncLauncher);
  new MutationObserver(syncLauncher).observe(document.documentElement, { childList: true, subtree: true });
  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (message.type !== 'AO_CRM_REVIEW') return;
    bridgeReady.then(() => send({action:'review', id:message.id, tag:message.tag})).then(()=>reply({ok:true})).catch(e=>reply({error:e.message}));
    return true;
  });
})();
