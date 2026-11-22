(() => {
  if (!location.pathname.startsWith('/website-opportunities')) return;
  if (window.__anthonyViewerBridge) return;
  window.__anthonyViewerBridge = true;
  const CHANNEL = 'anthonyos-website-viewer';
  const REQUEST = 'AO_BRIDGE_REQUEST', RESPONSE = 'AO_BRIDGE_RESPONSE';
  // Messages are accepted only from this extension's isolated content script.
  const inject = () => {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('crm-page.js');
    script.onload = () => script.remove();
    (document.head || document.documentElement).append(script);
  };
  inject();
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
  const button = document.createElement('button');
  button.textContent = 'Launch Website Viewer';
  Object.assign(button.style, { position:'fixed',bottom:'24px',right:'24px',zIndex:2147483647,padding:'14px 18px',background:'#6d5dfc',border:'1px solid #988dff',borderRadius:'12px',color:'#fff',font:'600 14px system-ui',cursor:'pointer',boxShadow:'0 8px 30px #0009' });
  button.addEventListener('click', async () => {
    button.disabled = true; button.textContent = 'Loading opportunities…';
    try {
      const data = await send({ action:'list' });
      const result = await chrome.runtime.sendMessage({ type:'AO_VIEW_START', items:data });
      if (result?.error) throw new Error(result.error);
      button.textContent = 'Viewer opened (' + result.total + ')';
    } catch(e) { button.textContent = 'Viewer error: ' + e.message; }
    finally { setTimeout(()=>{button.disabled=false;button.textContent='Launch Website Viewer';},3500); }
  });
  document.body.appendChild(button);
  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (message.type !== 'AO_CRM_REVIEW') return;
    send({action:'review', id:message.id, tag:message.tag}).then(()=>reply({ok:true})).catch(e=>reply({error:e.message}));
    return true;
  });
})();
