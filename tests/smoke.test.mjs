import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const load = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('manifest is valid MV3 and includes required integration scripts', () => {
  const m = JSON.parse(load('manifest.json'));
  assert.equal(m.manifest_version, 3);
  assert.equal(m.background.service_worker, 'background.js');
  assert.ok(m.content_scripts.some(s => s.js.includes('crm-bridge.js')));
  assert.ok(m.content_scripts.some(s => s.js.includes('review-overlay.js')));
  assert.ok(m.permissions.includes('scripting'));
  assert.equal(m.action.default_popup, 'popup.html');
});

test('all extension JavaScript parses', () => {
  for (const path of ['background.js','crm-bridge.js','crm-page.js','review-overlay.js','popup.js']) {
    assert.doesNotThrow(() => new vm.Script(load(path), { filename: path }));
  }
});

function mockBackground() {
  const listeners = {};
  const changes = [];
  const sent = [];
  const stored = {};
  const chrome = {
    runtime: { id: 'test-extension', onMessage: { addListener(f) { listeners.message = f; } },
      getURL(path) { return 'chrome-extension://test-extension/' + path; } },
    tabs: {
      onUpdated: { addListener(f) { listeners.updated = f; } },
      onRemoved: { addListener(f) { listeners.removed = f; } },
      async create({ url }) { changes.push(['create', url]); return { id: 77, url }; },
      async update(id, { url }) { changes.push(['update', id, url]); return { id, url }; },
      async sendMessage(tabId, message) { sent.push([tabId, message]); return { ok: true }; },
      async query() { return []; },
    },
    scripting: { async executeScript(options) { sent.push(['inject', options]); return []; } },
    storage: { session: { async get() { return { viewerState: stored.value }; },
      async set(value) { stored.value = value.viewerState; } } },
    action: { onClicked: { addListener() {} } },
  };
  vm.runInNewContext(load('background.js'), { chrome, URL, Promise }, { filename:'background.js' });
  const send = (message, sender) => new Promise(resolve => listeners.message(message, sender, resolve));
  return { send, changes, sent, stored, listeners };
}

test('opens unreviewed websites in one tab and advances on review', async () => {
  const b = mockBackground();
  const crm = { tab: { id: 10, url: 'https://autotext-psi.vercel.app/website-opportunities' } };
  const page = { tab: { id: 77, url: 'https://first.example/' } };
  const items = [
    { id:'one', title:'First', websiteUrl:'first.example', tags:[] },
    { id:'two', title:'Second', websiteUrl:'https://second.example', tags:[] },
  ];
  const start = await b.send({ type:'AO_VIEW_START', items }, crm);
  assert.equal(start.ok, true);
  assert.equal(start.total, 2);
  assert.deepEqual(b.changes[0], ['create','https://first.example/']);
  assert.equal((await b.send({type:'AO_VIEW_GET'},page)).index, 0);
  const review = await b.send({type:'AO_VIEW_REVIEW', tag:'Ugly Website'},page);
  assert.equal(review.ok,true);
  assert.equal(b.sent.some(([id,m]) => id===10 && m.type==='AO_CRM_REVIEW' && m.id==='one' && m.tag==='Ugly Website'),true);
  assert.deepEqual(b.changes.at(-1), ['update',77,'https://second.example/']);
  assert.equal((await b.send({type:'AO_VIEW_GET'},page)).total,1);
  assert.equal(b.stored.value.items.length,1);
  const finish = await b.send({type:'AO_VIEW_REVIEW',tag:''},page);
  assert.equal(finish.ok,true);
  assert.deepEqual(b.changes.at(-1),['update',77,'https://autotext-psi.vercel.app/website-opportunities']);
  assert.equal(b.stored.value.items.length,0);
});

test('navigation wraps without opening additional tabs', async () => {
  const b=mockBackground();
  const crm={ tab:{ id:10,url:'https://autotext-psi.vercel.app/website-opportunities'} };
  await b.send({type:'AO_VIEW_START',items:[
    {id:'one',websiteUrl:'https://first.example'},
    {id:'two',websiteUrl:'https://second.example'},
  ]},crm);
  await b.send({type:'AO_VIEW_MOVE',delta:-1},{tab:{id:77}});
  const state=await b.send({type:'AO_VIEW_GET'},{tab:{id:77}});
  assert.equal(state.index,1);
  assert.deepEqual(b.changes.at(-1),['update',77,'https://second.example/']);
  assert.equal(b.changes.filter(x=>x[0]==='create').length,1);
});

test('review fails without a CRM tab, preserving queue', async () => {
  const b=mockBackground();
  await b.send({type:'AO_VIEW_START',items:[{id:'one',websiteUrl:'https://first.example'}]},{tab:{id:10,url:'https://autotext-psi.vercel.app/website-opportunities'}});
  b.listeners.removed(10);
  const result=await b.send({type:'AO_VIEW_REVIEW',tag:'Good Website'},{tab:{id:77}});
  assert.match(result.error,/CRM tab unavailable/);
  assert.equal((await b.send({type:'AO_VIEW_GET'},{tab:{id:77}})).total,1);
});

test('starts at the opportunity selected by an Open Website click', async () => {
  const b=mockBackground();
  const crm={ tab:{id:10,url:'https://autotext-psi.vercel.app/website-opportunities'} };
  const response=await b.send({type:'AO_VIEW_START',startId:'two',items:[
    {id:'one',websiteUrl:'https://first.example'},
    {id:'two',websiteUrl:'https://second.example'},
  ]},crm);
  assert.equal(response.ok,true);
  assert.deepEqual(b.changes[0],['create','https://second.example/']);
  assert.equal((await b.send({type:'AO_VIEW_GET'},{tab:{id:77}})).index,1);
});

test('only installs the authenticated CRM bridge on CRM pages', async () => {
  const b=mockBackground();
  const bad=await b.send({type:'AO_INSTALL_CRM_PAGE'},{tab:{id:40,url:'https://another.example/'}});
  assert.match(bad.error,/Not the AnthonyOS CRM/);
  const good=await b.send({type:'AO_INSTALL_CRM_PAGE'},{tab:{id:10,url:'https://autotext-psi.vercel.app/website-opportunities'}});
  assert.equal(good.ok,true);
  assert.equal(b.sent.filter(([kind])=>kind==='inject').length,1);
});
