const tags=['Good Website','Ugly Website','Immediately Contact','Website Offline'];
const $=id=>document.getElementById(id);
const send=async data=>chrome.runtime.sendMessage(data);
const update=async()=>{
  const r=await send({type:'AO_VIEW_GET'});
  const has=!!r?.item;
  $('title').textContent=r.item?.title||'No website selected';
  $('count').textContent=r.total?`${r.index+1} of ${r.total}`:'Not running';
  $('state').textContent=r.waiting?'Saving…':'';
  for(const id of ['prev','next','review'])$(id).disabled=!has||r.waiting;
  $('tags').querySelectorAll('button').forEach(b=>b.disabled=!has||r.waiting);
};
$('crm').onclick=async()=>{
  const tabs=await chrome.tabs.query({url:'https://autotext-psi.vercel.app/*'});
  if(tabs.length)await chrome.tabs.update(tabs[0].id,{active:true,url:'https://autotext-psi.vercel.app/website-opportunities'});
  else await chrome.tabs.create({url:'https://autotext-psi.vercel.app/website-opportunities'});
  if (!location.search.includes('window=1')) window.close();
};
for(const [id,delta] of [['prev',-1],['next',1]])$(id).onclick=async()=>{await send({type:'AO_VIEW_MOVE',delta});await update();};
async function review(tag){
  $('error').textContent='';
  document.querySelectorAll('button').forEach(b=>b.disabled=true);
  try{const r=await send({type:'AO_VIEW_REVIEW',tag});if(!r?.ok)throw Error(r?.error||'Save failed');}
  catch(e){$('error').textContent=e.message;}
  finally{await update();}
}
$('review').onclick=()=>review('');
for(const tag of tags){const b=document.createElement('button');b.textContent=tag;b.onclick=()=>review(tag);$('tags').appendChild(b);}
update().catch(e=>{$('error').textContent=e.message;});
// Keep the separate control window current even on browser error pages.
if (location.search.includes('window=1')) {
  document.body.style.width = 'auto';
  setInterval(() => update().catch(e => { $('error').textContent = e.message; }), 1500);
}
