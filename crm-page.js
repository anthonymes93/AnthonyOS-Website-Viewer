(() => {
  // Main-world bridge. The CRM itself owns the authenticated Firestore client.
  // Extension code must not obtain admin credentials or a service-account key.
  const CHANNEL='anthonyos-website-viewer', REQUEST='AO_BRIDGE_REQUEST', RESPONSE='AO_BRIDGE_RESPONSE';
  window.addEventListener('message', async event => {
    if(event.source !== window || event.origin !== location.origin || event.data?.channel!==CHANNEL || event.data?.kind!==REQUEST) return;
    const {id,payload}=event.data;
    const respond=(out,error)=>window.postMessage({channel:CHANNEL,kind:RESPONSE,id,payload:out,error:error||null},location.origin);
    try {
      const api=window.__ANTHONYOS_WEBSITE_VIEWER__;
      if (!api || typeof api.list!=='function' || typeof api.review!=='function') throw new Error('CRM viewer integration not installed; update CRM first.');
      if(payload.action==='list') return respond(await api.list());
      if(payload.action==='review') { await api.review(payload.id,payload.tag); return respond({ok:true}); }
      throw new Error('Unsupported action');
    } catch(e){respond(null,String(e?.message??e));}
  });
})();
