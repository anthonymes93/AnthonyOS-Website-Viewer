(() => {
  if (window.__anthonyViewerOverlay) return;
  window.__anthonyViewerOverlay = true;
  const tags = ['Ugly Website','Good Website','Website Redesign Opportunity','AI Receptionist Opportunity','LeadBolt Opportunity','High Value'];
  let active=false, busy=false;
  const host=document.createElement('div'); host.id='anthonyos-viewer-overlay';
  host.style.cssText='position:fixed;bottom:18px;right:18px;z-index:2147483647;font:13px system-ui,sans-serif;color:#fff;';
  const root=host.attachShadow({mode:'closed'});
  root.innerHTML=`<style>*{box-sizing:border-box}main{width:354px;max-width:calc(100vw - 24px);background:#11141bf2;border:1px solid #444b60;border-radius:15px;padding:13px;box-shadow:0 12px 45px #0009;backdrop-filter:blur(12px)}header{display:flex;gap:12px;justify-content:space-between;align-items:center;margin-bottom:10px}strong{font-size:13px;max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}small{color:#adb5ce}nav{display:flex;gap:8px;align-items:center;justify-content:space-between}button{background:#252b38;border:1px solid #4a5368;border-radius:8px;color:#fff;padding:7px 10px;cursor:pointer;font:inherit}button:hover{background:#3c4560}button:disabled{opacity:.4;cursor:not-allowed}.tags{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:9px}.tags button{text-align:left;font-size:11px;padding:8px}.tags button:first-child{background:#654b24}footer{min-height:18px;color:#ffbd94;font-size:11px;padding-top:6px}a{color:#aab7ff;font-size:11px;text-decoration:none}</style><main><header><strong id="title">Website Viewer</strong><small id="count"></small></header><nav><button id="prev">← Previous</button><a id="listing" target="_blank" rel="noopener noreferrer">Kijiji listing</a><button id="next">Next →</button></nav><div class="tags" id="tags"></div><button style="width:100%;margin-top:8px" id="review">Mark reviewed without tag</button><footer id="status"></footer></main>`;
  const $=sel=>root.querySelector(sel);
  $('prev').onclick=()=>chrome.runtime.sendMessage({type:'AO_VIEW_MOVE',delta:-1});
  $('next').onclick=()=>chrome.runtime.sendMessage({type:'AO_VIEW_MOVE',delta:1});
  $('review').onclick=()=>review('');
  for(const tag of tags){const b=document.createElement('button');b.textContent=tag;b.onclick=()=>review(tag);$('tags').appendChild(b);}
  async function review(tag){
    if(busy)return;busy=true;$('status').textContent='Saving to AnthonyOS…'; setDisabled();
    try {const r=await chrome.runtime.sendMessage({type:'AO_VIEW_REVIEW',tag});if(r?.error)throw new Error(r.error);$('status').textContent='Saved';}
    catch(e){$('status').textContent='Save failed: '+e.message;}
    finally{busy=false;setDisabled();}
  }
  function setDisabled(){root.querySelectorAll('button').forEach(b=>b.disabled=busy);}
  function paint(s){active=!!s.active;if(!active){host.style.display='none';return;}host.style.display='block';if(!host.isConnected)document.documentElement.appendChild(host);
    $('title').textContent=s.item?.title || s.item?.websiteUrl || 'No remaining opportunities';
    $('count').textContent=s.total ? (s.index+1)+' / '+s.total : 'Complete';
    const listing=$('listing');listing.href=s.item?.listingUrl||'#';listing.style.display=s.item?.listingUrl?'':'none';
    $('status').textContent=s.waiting?'Saving…':'';
  }
  chrome.runtime.onMessage.addListener(m=>{if(m.type==='AO_VIEW_STATE')paint({...m,active:true});});
  chrome.runtime.sendMessage({type:'AO_VIEW_GET'}).then(paint).catch(()=>{});
})();
