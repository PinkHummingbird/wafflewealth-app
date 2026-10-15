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

const openAll=async(d,w)=>{ for(let i=0;i<50;i++){ const closed=d.querySelector('#txns [data-movement][aria-expanded="false"]'); if(!closed) break; closed.click(); await new Promise(r=>setTimeout(r,5)); } };
(async()=>{
 // ---------- example ----------
 {const {d,w,errs}=page({}); await sleep(300);
  ok(!d.getElementById('workspace').hidden,'example: workspace shows');
  ok(d.getElementById('welcome').hidden,'example: welcome hidden');
  ok(d.querySelectorAll('#docs .row').length===2,'example: 2 documents');
  ok(d.getElementById('n-new').textContent==='1','example: 1 new badge');
  ok(d.querySelectorAll('#txns [data-movement]').length>0 && !d.querySelector('#txns [data-edit]'),'example: grouped, lines closed');
  await openAll(d,w);
  ok(d.querySelectorAll('#txns .mv-open .row').length===8,'example: 5 typed + 3 statement lines');
  ok(d.querySelectorAll('#txns .mv-open .row .pill.auto').length===3 && Boolean(d.querySelector('#txns .mv-open .legend')),'example: statement lines tagged Auto, legend shown ('+d.querySelectorAll('#txns .pill.auto').length+' '+Boolean(d.querySelector('#txns .mv-open .legend'))+')');
  ok(d.querySelectorAll('#txns [data-edit]').length===5,'example: only typed ones can be edited');
  d.getElementById('group-account').checked=true; d.getElementById('group-account').dispatchEvent(new w.Event('change',{bubbles:true})); await sleep(20);
  const heads=[...d.querySelectorAll('#txns .month h3')].map(h=>h.textContent);
  ok(heads[0]==='Current account' && heads.includes('No account'),'by account: a section per account, yours first, no account last ('+heads.join(', ')+')');
  ok(!d.querySelector('#txns .mv-open'),'by account: groups start closed');
  d.getElementById('group-month').checked=true; d.getElementById('group-month').dispatchEvent(new w.Event('change',{bubbles:true})); await sleep(20);
  await openAll(d,w);
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
  await openAll(d,w);
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
  // plan: income and spending
  d.getElementById('tab-plan').click(); await sleep(20);
  ok(d.getElementById('as-income').value==='18,000.00' || d.getElementById('as-income').value==='18000.00','plan: income shown ('+d.getElementById('as-income').value+')');
  const store=w.WWApp.state.store; const versions=()=>store.history().length;
  const before=versions();
  setVal(d,'as-raise','five'); submit(d,'plan-form'); await sleep(50);
  ok(/Type a number/.test(d.getElementById('as-raise-err').textContent),'plan: a word for a percentage is refused');
  setVal(d,'as-raise','3.50'); setVal(d,'as-income','19,000'); submit(d,'plan-form'); await sleep(80);
  const a1=store.assumptions();
  ok(a1.f.monthly_income_minor===1900000 && a1.f.annual_raise_pct==='3.5','plan: saved in minor units, percentage as the app writes it');
  ok(versions()===before+1,'plan: a changed figure adds a line of history');
  submit(d,'plan-form'); await sleep(80);
  ok(versions()===before+1,'plan: saving the same figures adds none');
  // plan: planned items
  setVal(d,'pi-name','School fees'); setVal(d,'pi-amount','4,000'); setVal(d,'pi-first','2027-01-10'); setVal(d,'pi-frequency','ANNUAL');
  d.getElementById('pi-frequency').dispatchEvent(new w.Event('change')); setVal(d,'pi-ends','2026-01-01'); submit(d,'pi-form'); await sleep(50);
  ok(/stop before it starts/.test(d.getElementById('pi-endsOn-err').textContent),'planned: ending before it starts is refused');
  setVal(d,'pi-ends',''); submit(d,'pi-form'); await sleep(80);
  const fees=store.planned(false).find(p=>p.f.name==='School fees');
  ok(fees && fees.f.amount_minor===400000 && fees.f.direction==='OUT' && fees.f.currency_code===null && fees.f.frequency==='ANNUAL' && fees.f.growth_pct==='0','planned: added in the base currency');
  d.querySelector(`[data-planned-edit="${fees.name}"]`).click(); await sleep(20);
  setVal(d,'pi-amount','4,500'); submit(d,'pi-form'); await sleep(80);
  ok(store.rows.get(fees.name).f.amount_minor===450000,'planned: edited');
  d.querySelector(`[data-planned-away="${fees.name}"]`).click(); await sleep(80);
  ok(store.rows.get(fees.name).f.archived_at && /School fees/.test(d.getElementById('planned-away').textContent),'planned: put away');
  w.confirm=()=>true; d.querySelector(`[data-planned-delete="${fees.name}"]`).click(); await sleep(80);
  ok(!store.rows.has(fees.name),'planned: deleted once put away');
  // accounts: rename, invested, put away and back
  d.getElementById('tab-accounts').click();
  d.querySelector('[data-account-edit="ex-current"]').click(); await sleep(20);
  setVal(d,'acc-name',''); d.querySelector('[data-account-form]').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true})); await sleep(50);
  ok(/name/.test(d.getElementById('acc-name-err').textContent),'account: empty name refused');
  setVal(d,'acc-name','Everyday account'); d.getElementById('acc-invested').checked=true;
  d.querySelector('[data-account-form]').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true})); await sleep(80);
  ok(store.account('ex-current').f.name==='Everyday account' && store.account('ex-current').f.is_invested===1,'account: renamed and growing');
  d.querySelector('[data-account-edit="ex-current"]').click(); await sleep(20);
  d.querySelector('[data-account-away="ex-current"]').click(); await sleep(80);
  ok(store.account('ex-current').f.archived_at && /Everyday account/.test(d.getElementById('accts-away').textContent),'account: put away');
  d.querySelector('[data-account-restore="ex-current"]').click(); await sleep(80);
  ok(!store.account('ex-current').f.archived_at,'account: put back');
  // projection, worked out here
  w.WWProjection = await import(require('url').pathToFileURL(require('path').join(__dirname,'..','projection.mjs')).href);
  w.WWApp.render(); await sleep(50);
  d.getElementById('tab-projection').click(); await sleep(50);
  const hero=d.querySelector('.proj-hero');
  ok(hero && /Net worth now/.test(hero.textContent) && /USD/.test(hero.textContent),'projection: the headline, in the base currency');
  ok(d.querySelectorAll('.proj-table tbody tr').length===25,'projection: now and 24 months ('+d.querySelectorAll('.proj-table tbody tr').length+')');
  ok(d.querySelector('#proj-chart svg path.line'),'projection: the line is drawn');
  ok(/Available/.test(d.getElementById('proj-body').textContent),'projection: the pension locked until 60 shows what is within reach');
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
  ok(doc && !doc.fields.file && doc.fields.parts.value===1 && doc.fields.parts.type==='INT64','icloud: no attachment, one piece');
  const p0=w.__ck.records.get(`documentpart-${doc.recordName}-0`);
  ok(p0 && p0.fields.data.type==='BYTES' && !p0.fields.nulls && p0.fields.document_id.value===doc.recordName && p0.fields.part.value===0,'icloud: the piece is a record of its own');
  ok(p0 && Buffer.from(p0.fields.data.value,'base64').toString()==='a,b\n1,2','icloud: the piece holds the file');
  // a bigger file: pieces in order, joined back exactly
  const big=new Uint8Array(w.WWCloud.PIECE_BYTES*2+1234); for(let i=0;i<big.length;i++) big[i]=(i*7+3)%256;
  Object.defineProperty(input,'files',{value:[new w.File([big],'big.pdf',{type:'application/pdf'})],configurable:true}); input.dispatchEvent(new w.Event('change')); await sleep(400);
  const bigDoc=[...w.__ck.records.values()].find(r=>r.recordType==='Document'&&r.fields.file_name.value==='big.pdf');
  ok(bigDoc && bigDoc.fields.parts.value===3,'icloud: a bigger file goes in 3 pieces');
  const joined=await w.WWApp.state.store.documentFile(w.WWApp.state.store.rows.get(bigDoc.recordName));
  const back=await new Promise(res=>{const fr=new w.FileReader(); fr.onload=()=>res(new Uint8Array(fr.result)); fr.readAsArrayBuffer(joined);});
  ok(back.length===big.length && back.every((v,i)=>v===big[i]),'icloud: the pieces join back byte for byte');
  ok(!('data' in w.WWApp.state.store.rows.get(`documentpart-${bigDoc.recordName}-1`).f),'icloud: pieces kept here without their bytes');
  // stopping half way takes the pieces back, and no document appears
  w.__ck.failAfter=1;
  Object.defineProperty(input,'files',{value:[new w.File([big],'stops.pdf')],configurable:true}); input.dispatchEvent(new w.Event('change')); await sleep(400);
  ok(![...w.__ck.records.values()].some(r=>r.recordType==='Document'&&r.fields.file_name.value==='stops.pdf'),'icloud: a stopped upload leaves no document');
  ok([...w.__ck.records.values()].filter(r=>r.recordType==='DocumentPart').length===4,'icloud: and none of its pieces');
  // removing a document takes its pieces
  w.confirm=()=>true;
  d.querySelector(`[data-remove-doc="${bigDoc.recordName}"]`).click(); await sleep(150);
  ok(![...w.__ck.records.keys()].some(k=>k.startsWith(`documentpart-${bigDoc.recordName}`)),'icloud: removing a document removes its pieces');
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
  await openAll(d,w);
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
  await openAll(d,w);
  const rows=[...d.querySelectorAll('#txns .mv-open .row')].map(r=>r.textContent.replace(/\s+/g,' '));
  ok(rows.length===3 && /Fuel/.test(rows[0]) && /Made up grocer/.test(rows[1]) && /To my savings/.test(rows[2]),'icloud: typed first, then statement order, undated line left out ('+rows.length+')');
  ok(/Out AED\u00A0320.00/.test(d.getElementById('txns').textContent),'icloud: month total leaves out a move between own accounts');
  ok(!d.querySelector('[data-edit="l1"]'),'icloud: a statement line is read-only');
  // balance from the web
  d.getElementById('tab-accounts').click(); d.querySelector('[data-balance="a1"]').click(); setVal(d,'bal-amount','13000'); setVal(d,'bal-day','2026-10-11');
  d.querySelector('[data-balance-form]').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true})); await sleep(150);
  const nb=[...w.__ck.records.values()].filter(r=>r.recordType==='Balance').find(r=>r.fields.as_of_date.value==='2026-10-11');
  ok(nb && nb.fields.value_minor.value===1300000 && nb.fields.source.value==='MANUAL','icloud: balance appended');
  // a statement read here: stub reader, the real save
  {
    const save = await import(require('url').pathToFileURL(require('path').join(__dirname,'..','statement-save.mjs')).href);
    const made = (sha, closing) => ({ reader:'SG-UOB', institution:'Made-up Bank', fileName:'aug.csv', period:{from:'2026-08-01',to:'2026-09-30'}, sha256:sha,
      accounts:[{ ref:'SG-UOB:111', name:'Made-up Bank ·· 0111', type:'current', owed:false, currency:'SGD', ratePct:null, closes:null, closed:false,
        opening:100000, closing, check:{ok:true,checked:true}, lines:[
          {date:'2026-08-20',madeOn:null,description:'Made-up grocer',amount:-10000,running:null,ref:null,foreign:null,label:'out'},
          {date:'2026-09-03',madeOn:null,description:'Made-up pay',amount:closing-90000,running:null,ref:null,foreign:null,label:'in'}]}] });
    let next=made('a'.repeat(64), 95000);
    w.WWStatementModules={ ...save, readDocument: async ()=>({statements:[next], problems:[]}) };
    d.getElementById('tab-documents').click();
    const up=d.getElementById('file'); Object.defineProperty(up,'files',{value:[new w.File(['made,up\n'],'aug.csv')],configurable:true}); up.dispatchEvent(new w.Event('change')); await sleep(200);
    const doc1=[...w.__ck.records.values()].find(r=>r.recordType==='Document'&&r.fields.file_name.value==='aug.csv');
    const readBtn=d.querySelector(`[data-read-doc="${doc1.recordName}"]`);
    ok(readBtn,'statement: a new CSV can be read here');
    readBtn.click(); await sleep(150);
    ok(!d.getElementById('review').hidden && /Adds up/.test(d.getElementById('review').textContent),'statement: reviewed, the check shown: '+d.getElementById('review').textContent.replace(/\s+/g,' ').slice(0,300));
    ok(d.querySelector('[data-review-include="0:0"]').checked,'statement: kept by default');
    ok(!/Below zero/.test(d.getElementById('review').textContent),'statement: no overdraft note when nothing is below zero');
    setVal(d,'rv-name-0-0','My SGD account'); d.getElementById('rv-name-0-0').dispatchEvent(new w.Event('input',{bubbles:true}));
    w.__ck.atomics=[];
    d.getElementById('review-add').click(); await sleep(200);
    const all=[...w.__ck.records.values()];
    const st=all.find(r=>r.recordType==='Statement'); const acct=all.find(r=>r.recordType==='Account'&&r.fields.name.value==='My SGD account');
    ok(st && st.fields.file_sha256.value==='a'.repeat(64) && st.fields.reader.value==='SG-UOB','statement: the statement kept');
    ok(acct && acct.fields.display_order.type==='INT64' && acct.fields.kind.value==='ASSET' && acct.fields.currency_code.value==='SGD','statement: a new account');
    const bals=all.filter(r=>r.recordType==='Balance'&&r.fields.account_id.value===acct.recordName);
    ok(bals.length===2 && bals.every(b=>b.fields.source.value==='STATEMENT'),'statement: month end and closing balances');
    ok(w.__ck.records.get(`statement-account-${acct.recordName}`).fields.ref.value==='SG-UOB:111','statement: the bank link');
    const lines=all.filter(r=>r.recordType==='StatementLine'&&r.fields.statement_id.value===st.recordName);
    ok(lines.length===2 && lines[0].fields.position.type==='INT64' && /made_on/.test(lines[0].fields.nulls.value),'statement: lines, typed, nulls named: '+JSON.stringify(lines[0]&&lines[0].fields));
    ok(w.__ck.atomics.length===1 && w.__ck.atomics[0]===true,'statement: one request iCloud keeps whole');
    ok(w.__ck.records.get(doc1.recordName).fields.status.value==='ADDED','statement: the document marked added');
    ok(!d.querySelector(`[data-read-doc="${doc1.recordName}"]`) && /Added to your money/.test(d.getElementById('upload-ok').textContent),'statement: said so, and no more Read here');
    // the same bank account next month adds to the same account; the same file again is already added
    next=made('b'.repeat(64), 97000); next.accounts[0].belowZero=true;
    Object.defineProperty(up,'files',{value:[new w.File(['made,up,2\n'],'sep.csv')],configurable:true}); up.dispatchEvent(new w.Event('change')); await sleep(200);
    const doc2=[...w.__ck.records.values()].find(r=>r.recordType==='Document'&&r.fields.file_name.value==='sep.csv');
    d.querySelector(`[data-read-doc="${doc2.recordName}"]`).click(); await sleep(150);
    ok(/My SGD account/.test(d.getElementById('review').textContent) && /Adds to this account/.test(d.getElementById('review').textContent),'statement: found by its bank reference');
    ok(/Below zero on this statement/.test(d.getElementById('review').textContent),'statement: an overdraft is named, as the statements page names it');
    d.getElementById('review-add').click(); await sleep(200);
    ok([...w.__ck.records.values()].filter(r=>r.recordType==='Account'&&/SGD/.test(r.fields.currency_code.value)).length===1,'statement: no second account');
    next=made('b'.repeat(64), 97000);
    Object.defineProperty(up,'files',{value:[new w.File(['again\n'],'sep-again.csv')],configurable:true}); up.dispatchEvent(new w.Event('change')); await sleep(200);
    const doc3=[...w.__ck.records.values()].find(r=>r.recordType==='Document'&&r.fields.file_name.value==='sep-again.csv');
    d.querySelector(`[data-read-doc="${doc3.recordName}"]`).click(); await sleep(150);
    ok(/Already added/.test(d.getElementById('review').textContent) && !d.getElementById('review-add'),'statement: the same file twice is already added');
    d.getElementById('review-cancel').click(); await sleep(20);
    ok(d.getElementById('review').hidden,'statement: closed');
  }
  // settings from the phone, edited here: types, nulls and the change tag as the app needs them
  w.__ck.put({recordType:'Assumptions',recordName:'assumptions-1',fields:{base_currency_code:{value:'AED'},monthly_income_minor:{value:4500000},monthly_spending_minor:{value:2200000},annual_raise_pct:{value:'5'},raise_effective_month:{value:4},annual_spending_growth_pct:{value:'3'},annual_return_pct:{value:'7'},horizon_months:{value:12},updated_at:{value:'2026-09-08T10:00:00.000Z'},annual_withdrawal_pct:{value:'4'},nulls:{value:'birth_month,birth_year,fire_growth_pct,fire_interest_pct,income_day'}}});
  d.getElementById('refresh').click(); await sleep(150);
  d.getElementById('tab-plan').click(); await sleep(20);
  const asTag=w.__ck.records.get('assumptions-1').recordChangeTag;
  setVal(d,'as-spending','23,000'); submit(d,'plan-form'); await sleep(150);
  const as=w.__ck.records.get('assumptions-1');
  ok(asTag && w.__ck.sentTags['assumptions-1']===asTag,'icloud: settings sent with their change tag');
  ok(as.fields.monthly_spending_minor.value===2300000 && as.fields.monthly_spending_minor.type==='INT64' && as.fields.raise_effective_month.type==='INT64','icloud: settings amounts INT64');
  ok(as.fields.annual_return_pct.value==='7' && as.fields.annual_return_pct.type==='STRING','icloud: percentages as plain strings');
  ok(as.fields.nulls.value==='birth_month,birth_year,fire_growth_pct,fire_interest_pct,income_day','icloud: empty settings named as nulls');
  ok(as.fields.updated_at.value>'2026-09-08T10:00:00.000Z','icloud: a later edit is stamped later');
  ok(!('fx_auto_refresh' in as.fields),'icloud: the rates switch is never sent');
  const line=[...w.__ck.records.values()].find(r=>r.recordType==='AssumptionVersion');
  ok(line && line.fields.monthly_spending_minor.value===2300000 && line.fields.written_order.type==='INT64' && line.fields.valid_from.value===as.fields.updated_at.value,'icloud: a line of history with it');
  // a planned item
  setVal(d,'pi-name','Bonus'); d.getElementById('pi-in').checked=true; setVal(d,'pi-amount','10,000'); setVal(d,'pi-first','2026-12-15'); submit(d,'pi-form'); await sleep(150);
  const pi=[...w.__ck.records.values()].find(r=>r.recordType==='PlannedItem');
  d.querySelector(`[data-planned-away="${pi.recordName}"]`).click(); await sleep(150);
  ok(w.__ck.records.get(pi.recordName).fields.archived_at && w.__ck.records.get(pi.recordName).fields.archived_at.value,'icloud: put away');
  w.__ck.ops=[];
  d.querySelector(`[data-planned-restore="${pi.recordName}"]`).click(); await sleep(150);
  const putBack=w.__ck.records.get(pi.recordName);
  ok(!putBack.fields.archived_at && /archived_at/.test(putBack.fields.nulls.value) && w.__ck.ops.includes('PlannedItem:replace'),'icloud: put back replaces the record, so the date is gone in iCloud ('+w.__ck.ops.join(',')+')');
  ok(pi && pi.fields.direction.value==='IN' && pi.fields.amount_minor.value===1000000 && pi.fields.display_order.type==='INT64','icloud: planned item fields');
  ok(pi && pi.fields.nulls.value==='archived_at,category,currency_code,ends_on','icloud: planned item nulls ('+(pi&&pi.fields.nulls.value)+')');
  // an account renamed
  d.getElementById('tab-accounts').click(); d.querySelector('[data-account-edit="a1"]').click(); await sleep(20);
  setVal(d,'acc-name','Everyday AED'); d.querySelector('[data-account-form]').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true})); await sleep(150);
  const ac=w.__ck.records.get('a1');
  ok(ac.fields.name.value==='Everyday AED' && ac.fields.is_invested.type==='INT64' && /archived_at/.test(ac.fields.nulls.value),'icloud: account renamed, still in use');
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
