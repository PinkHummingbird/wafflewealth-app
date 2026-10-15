// The page against made-up records: once in the example, once against a fake CloudKit that
// checks every record the page sends. Needs jsdom: npm i jsdom, then node web/tests/page.test.cjs
const {JSDOM,VirtualConsole}=require('jsdom');const fs=require('fs');const path=require('path');
const W=path.join(__dirname,'..');
const read=f=>fs.readFileSync(path.join(W,f),'utf8');
function page({token, fake}){
  let html=read('index.html');
  const fakeCK = fake ? `<script>${fake}</script>` : '';
  html=html.replace(/<script src="https:\/\/cdn.apple-cloudkit.com[^>]*><\/script>/, fakeCK);
  let app=read('app.js'); if(token) app=app.replace('apiToken: ""',`apiToken: "${token}"`);
  html=html.replace(/<script src="money\.js(\?v=\d+)?"><\/script>/,`<script>${read('money.js')}</script>`)
           .replace(/<script src="cloud\.js(\?v=\d+)?"><\/script>/,`<script>${read('cloud.js')}</script>`)
           .replace(/<script src="app\.js(\?v=\d+)?"><\/script>/,`<script>${app}</script>`);
  const vc=new VirtualConsole();const errs=[];vc.on('jsdomError',e=>errs.push(String(e.stack||e)));vc.on('error',e=>errs.push(String(e)));
  const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,url:'https://pinkhummingbird.github.io/wafflewealth-app/web/'+(token?'':'?example'),virtualConsole:vc,
    beforeParse(w){w.URL.createObjectURL=()=> 'blob:x'; w.confirm=()=>true; w.Intl=Intl; w.structuredClone=structuredClone;}});
  return {dom,errs,w:dom.window,d:dom.window.document};
}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let fails=0; const ok=(c,m)=>{ if(!c){fails++;console.log('FAIL',m)} else console.log('ok  ',m) };
function setVal(d,id,v){const el=d.getElementById(id); el.value=v; el.dispatchEvent(new d.defaultView.Event('input',{bubbles:true})); el.dispatchEvent(new d.defaultView.Event('change',{bubbles:true}));}
function submit(d,id){d.getElementById(id).dispatchEvent(new d.defaultView.Event('submit',{bubbles:true,cancelable:true}));}

(async()=>{
 // ---------- example ----------
 {const {d,w,errs}=page({}); await sleep(300);
  ok(!d.getElementById('workspace').hidden,'example: workspace shows');
  ok(d.getElementById('welcome').hidden,'example: welcome hidden');
  ok(d.querySelectorAll('#docs .row').length===2,'example: 2 documents');
  ok(d.getElementById('n-new').textContent==='1','example: 1 new badge');
  ok(d.querySelectorAll('#txns .row').length===8,'example: 5 typed + 3 statement lines');
  ok(d.querySelectorAll('#txns .pill.auto').length===3 && !d.getElementById('txns-legend').hidden,'example: statement lines tagged Auto, legend shown');
  ok(d.querySelectorAll('#txns [data-edit]').length===5,'example: only typed ones can be edited');
  ok(/Current account/.test(d.getElementById('accts').textContent),'example: accounts listed');
  ok(/USD 48,000.00/.test(d.getElementById('accts').textContent),'example: latest balance shown 48,000');
  // tabs
  d.getElementById('tab-transactions').click();
  ok(!d.getElementById('panel-transactions').hidden && d.getElementById('panel-documents').hidden,'tabs switch to transactions');
  // validation: empty amount
  submit(d,'txn-form'); await sleep(50);
  ok(d.getElementById('txn-amount-err').textContent==='Type an amount.','validation: empty amount');
  setVal(d,'txn-amount','12.345'); setVal(d,'txn-currency','USD'); submit(d,'txn-form'); await sleep(50);
  ok(/at most 2 decimals/.test(d.getElementById('txn-amount-err').textContent),'validation: too many decimals');
  setVal(d,'txn-amount','0'); submit(d,'txn-form'); await sleep(50);
  ok(/zero/.test(d.getElementById('txn-amount-err').textContent),'validation: zero');
  // valid
  setVal(d,'txn-account','ex-savings'); ok(d.getElementById('txn-currency').value==='GBP','account picks its currency');
  setVal(d,'txn-amount','1,250.5'); setVal(d,'txn-note','Groceries'); setVal(d,'txn-category','P_HOME'); submit(d,'txn-form'); await sleep(100);
  ok(d.querySelectorAll('#txns [data-edit]').length===6,'saved: 6 typed transactions');
  ok(/−GBP 1,250.50/.test(d.getElementById('txns').textContent),'saved: shown as −GBP 1,250.50');
  ok(!d.getElementById('txn-ok').hidden,'saved: confirmation shown');
  const saved=[...w.WWApp.state.store.rows.values()].find(r=>r.f.note==='Groceries');
  ok(saved && saved.f.amount_minor===-125050 && saved.f.source==='WEB' && saved.f.category==='P_HOME','saved: signed minor units, WEB, category');
  // edit
  d.querySelector(`[data-edit="${saved.name}"]`).click(); await sleep(20);
  ok(d.getElementById('txn-title').textContent==='Edit transaction' && d.getElementById('txn-amount').value==='1,250.50','edit: form loaded');
  d.getElementById('dir-in').checked=true; d.getElementById('dir-in').dispatchEvent(new w.Event('change',{bubbles:true}));
  ok(d.getElementById('txn-category').value==='','edit: switching direction drops an out category');
  submit(d,'txn-form'); await sleep(100);
  const edited=w.WWApp.state.store.rows.get(saved.name);
  ok(edited.f.amount_minor===125050,'edit: now money in');
  // delete
  d.querySelector(`[data-edit="${saved.name}"]`).click(); await sleep(20);
  d.getElementById('txn-delete').click(); await sleep(50);
  ok(!w.WWApp.state.store.rows.has(saved.name),'delete: gone');
  // balance
  d.getElementById('tab-accounts').click();
  d.querySelector('[data-balance="ex-current"]').click(); await sleep(20);
  setVal(d,'bal-amount','-5'); d.querySelector('[data-balance-form]').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true})); await sleep(50);
  ok(/Type a number/.test(d.getElementById('bal-amount-err').textContent),'balance: negative refused');
  setVal(d,'bal-amount','49,100'); d.querySelector('[data-balance-form]').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true})); await sleep(80);
  ok(/USD 49,100.00/.test(d.getElementById('accts').textContent),'balance: new latest shown');
  // upload
  d.getElementById('tab-documents').click();
  const file=new w.File(['%PDF-1.4 made up'],'October.pdf',{type:'application/pdf'});
  const input=d.getElementById('file'); Object.defineProperty(input,'files',{value:[file],configurable:true}); input.dispatchEvent(new w.Event('change'));
  await sleep(80);
  ok(d.querySelectorAll('#docs .row').length===3 && /October.pdf/.test(d.getElementById('docs').textContent),'upload: listed');
  ok(d.getElementById('n-new').textContent==='2','upload: badge 2');
  const empty=new w.File([],'empty.pdf'); Object.defineProperty(input,'files',{value:[empty],configurable:true}); input.dispatchEvent(new w.Event('change')); await sleep(50);
  ok(/empty/.test(d.getElementById('upload-problems').textContent),'upload: empty refused');
  ok(errs.length===0,'example: no script errors '+errs.join(' | '));
 }
 // ---------- fake iCloud ----------
 const fake = fs.readFileSync(path.join(__dirname,'fake-cloudkit.js'),'utf8');
 {const {d,w,errs}=page({token:'test-token',fake}); await sleep(50);
  ok(!d.getElementById('welcome').hidden,'icloud: signed out shows welcome');
  ok(d.getElementById('not-ready').hidden,'icloud: configured, so no "opens soon"');
  // sign in
  w.__ck.signIn(); await sleep(150);
  ok(!d.getElementById('workspace').hidden,'icloud: signed in shows workspace');
  ok(!d.getElementById('nothing-yet').hidden,'icloud: zone missing → nothing-yet notice');
  // upload creates zone then saves
  const input=d.getElementById('file'); const file=new w.File(['a,b\n1,2'],'wise.csv',{type:'text/csv'});
  Object.defineProperty(input,'files',{value:[file],configurable:true}); input.dispatchEvent(new w.Event('change')); await sleep(150);
  const doc=[...w.__ck.records.values()].find(r=>r.recordType==='Document');
  ok(w.__ck.zone,'icloud: zone created on first save');
  ok(doc && doc.fields.byte_count.type==='INT64' && doc.fields.status.value==='NEW' && doc.fields.added_from.value==='WEB','icloud: document fields typed');
  ok(doc && doc.fields.nulls.value==='note,status_at,status_note','icloud: nulls named');
  ok(doc && doc.fields.file && doc.fields.file.value instanceof w.Blob && doc.fields.file.value.size===file.size,'icloud: file sent as asset');
  ok(doc && doc.fields.file.value.type==='' && doc.fields.file_name.value==='wise.csv','icloud: bytes untyped, name in the record');
  // the phone syncs accounts in
  w.__ck.put({recordType:'Account',recordName:'a1',fields:{name:{value:'Everyday'},kind:{value:'ASSET'},currency_code:{value:'AED'},display_order:{value:0},created_at:{value:'2026-10-01T00:00:00.000Z'},nulls:{value:'archived_at,category'}}});
  w.__ck.put({recordType:'Balance',recordName:'b1',fields:{account_id:{value:'a1'},value_minor:{value:1234567},as_of_date:{value:'2026-10-01'},source:{value:'MANUAL'},created_at:{value:'2026-10-01T00:00:00.000Z'},nulls:{value:''}}});
  w.__ck.put({recordType:'Balance',recordName:'b2',fields:{account_id:{value:'a1'},value_minor:{value:9999999},as_of_date:{value:'2026-10-05'},source:{value:'MANUAL'},created_at:{value:'2026-10-05T00:00:00.000Z'},nulls:{value:''}}});
  w.__ck.put({recordType:'BalanceWithdrawal',recordName:'withdrawal-b2',fields:{withdrawn_at:{value:'2026-10-06T00:00:00.000Z'},nulls:{value:''}}});
  d.getElementById('refresh').click(); await sleep(150);
  ok(d.getElementById('nothing-yet').hidden,'icloud: notice goes once accounts arrive');
  ok(/AED 12,345.67/.test(d.getElementById('accts').textContent),'icloud: withdrawn balance skipped, standing one shown');
  // transaction
  d.getElementById('tab-transactions').click();
  setVal(d,'txn-account','a1'); setVal(d,'txn-amount','300'); setVal(d,'txn-day','2026-10-10'); submit(d,'txn-form'); await sleep(150);
  const t=[...w.__ck.records.values()].find(r=>r.recordType==='Transaction');
  ok(t && t.fields.amount_minor.value===-30000 && t.fields.amount_minor.type==='INT64','icloud: transaction amount INT64 signed');
  ok(t && t.fields.currency_code.value==='AED' && t.fields.account_id.value==='a1' && t.fields.occurred_on.value==='2026-10-10','icloud: transaction fields');
  ok(t && t.fields.nulls.value==='category,note','icloud: transaction nulls');
  // edit sends change tag
  const before=t.recordChangeTag;
  d.querySelector(`[data-edit="${t.recordName}"]`).click(); setVal(d,'txn-note','Fuel'); submit(d,'txn-form'); await sleep(150);
  ok(before && w.__ck.lastSaveTag===before,'icloud: edit sends the record change tag ('+before+' vs '+w.__ck.lastSaveTag+')');
  ok(w.__ck.records.get(t.recordName).fields.note.value==='Fuel' && w.__ck.records.get(t.recordName).fields.nulls.value==='category','icloud: edit updates note and nulls');
  // conflict path
  w.__ck.failNext='CONFLICT';
  d.querySelector(`[data-edit="${t.recordName}"]`).click(); setVal(d,'txn-note','Fuel 2'); submit(d,'txn-form'); await sleep(200);
  ok(/changed somewhere else/.test(d.getElementById('txn-error').textContent),'icloud: conflict explained');
  // a statement line from the phone: listed as Auto, own moves left out of the totals
  w.__ck.put({recordType:'StatementLine',recordName:'l1',fields:{statement_id:{value:'s1'},account_id:{value:'a1'},position:{value:0},posted_on:{value:'2026-10-10'},description:{value:'Made up grocer'},amount_minor:{value:-2000},line_kind:{value:'out'},nulls:{value:''}}});
  w.__ck.put({recordType:'StatementLine',recordName:'l2',fields:{statement_id:{value:'s1'},account_id:{value:'a1'},position:{value:1},posted_on:{value:'2026-10-10'},description:{value:'To my savings'},amount_minor:{value:-500000},line_kind:{value:'own'},nulls:{value:''}}});
  w.__ck.put({recordType:'StatementLine',recordName:'l3',fields:{statement_id:{value:'s1'},account_id:{value:'a1'},position:{value:2},description:{value:'Undated'},amount_minor:{value:-1},nulls:{value:'posted_on'}}});
  d.getElementById('refresh').click(); await sleep(150);
  const rows=[...d.querySelectorAll('#txns .row')].map(r=>r.textContent.replace(/\s+/g,' '));
  ok(rows.length===3 && /Fuel/.test(rows[0]) && /Made up grocer/.test(rows[1]) && /To my savings/.test(rows[2]),'icloud: typed first, then statement order, undated line left out ('+rows.length+')');
  ok(/Out AED\u00A0320.00/.test(d.getElementById('txns').textContent),'icloud: month total leaves out a move between own accounts');
  ok(!d.querySelector('[data-edit="l1"]'),'icloud: a statement line is read-only');
  // balance from the web
  d.getElementById('tab-accounts').click(); d.querySelector('[data-balance="a1"]').click(); setVal(d,'bal-amount','13000'); setVal(d,'bal-day','2026-10-11');
  d.querySelector('[data-balance-form]').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true})); await sleep(150);
  const nb=[...w.__ck.records.values()].filter(r=>r.recordType==='Balance').find(r=>r.fields.as_of_date.value==='2026-10-11');
  ok(nb && nb.fields.value_minor.value===1300000 && nb.fields.source.value==='MANUAL','icloud: balance appended');
  // sign out
  w.__ck.signOut(); await sleep(100);
  ok(!d.getElementById('welcome').hidden && d.getElementById('workspace').hidden,'icloud: sign out returns to welcome');
  ok(errs.length===0,'icloud: no script errors '+errs.join(' | '));
 }
 // ---------- no token ----------
 {const {d,errs}=page({token:'',fake:fs.readFileSync(path.join(__dirname,'fake-cloudkit.js'),'utf8')}); await sleep(50);
  // page() with no token uses ?example, so check the unconfigured path separately
 }
 console.log(fails?`${fails} FAILED`:'ALL PASSED'); process.exit(fails?1:0);
})();
