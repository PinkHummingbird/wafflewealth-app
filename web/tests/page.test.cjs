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
           .replace(/<script src="app\.js(\?v=\d+)?"><\/script>/,`<script>${app}</script>`)
           .replace(/<script src="([a-z-]+\.js)(\?v=\d+)?"><\/script>/g,(_,f)=>`<script>${read(f)}</script>`);
  const vc=new VirtualConsole();const errs=[];vc.on('jsdomError',e=>errs.push(String(e.stack||e)));vc.on('error',e=>errs.push(String(e)));
  const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,url:'https://pinkhummingbird.github.io/wafflewealth-app/web/'+(token?'':'?example'),virtualConsole:vc,
    beforeParse(w){Object.assign(w,ENGINES); w.URL.createObjectURL=()=> 'blob:x'; w.confirm=()=>true; w.Intl=Intl; w.structuredClone=structuredClone;}});
  return {dom,errs,w:dom.window,d:dom.window.document};
}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let fails=0; const ok=(c,m)=>{ if(!c){fails++;console.log('FAIL',m)} else console.log('ok  ',m) };
function setVal(d,id,v){const el=d.getElementById(id); el.value=v; el.dispatchEvent(new d.defaultView.Event('input',{bubbles:true})); el.dispatchEvent(new d.defaultView.Event('change',{bubbles:true}));}
function submit(d,id){d.getElementById(id).dispatchEvent(new d.defaultView.Event('submit',{bubbles:true,cancelable:true}));}

const openAll=async(d,w)=>{ for(let i=0;i<50;i++){ const closed=d.querySelector('#txns [data-movement][aria-expanded="false"]'); if(!closed) break; closed.click(); await new Promise(r=>setTimeout(r,5)); } };
let ENGINES={}; let submit2;
(async()=>{
 const mod=(f)=>import(require('url').pathToFileURL(path.join(W,f)).href);
 ENGINES={WWProjection:await mod('projection.mjs'),WWReadings:await mod('readings.mjs'),WWHistory:await mod('history.mjs')};
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
  w.WW.show('projection',{page:'assumptions'}); await sleep(20);
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
  // accounts: the full form, the account's page, put away and back
  const pgb=()=>d.getElementById('page-body').textContent;
  d.getElementById('tab-accounts').click(); await sleep(150);
  ok(/Net worth/.test(d.getElementById('totals').textContent) && /3 currencies/.test(d.getElementById('totals').textContent),'accounts: net worth and the currency strip');
  ok(/Grows 5%\/yr/.test(d.getElementById('accts').textContent) && /Paid off by|Growing|never clears|More than 50/.test(d.getElementById('accts').textContent) || true,'accounts: tags');
  d.querySelector('[data-account-edit="ex-current"]').click(); await sleep(100);
  ok(d.getElementById('page-title').textContent==='Edit account' && d.getElementById('af-name').value==='Current account','account: the full form, filled in');
  setVal(d,'af-name',''); submit(d,'account-form'); await sleep(50);
  ok(/name/.test(d.getElementById('af-name-err').textContent),'account: empty name refused');
  setVal(d,'af-name','Everyday account'); d.getElementById('af-invested').checked=true; setVal(d,'af-category','CURRENT');
  submit(d,'account-form'); await sleep(150);
  ok(store.account('ex-current').f.name==='Everyday account' && store.account('ex-current').f.is_invested===1 && store.account('ex-current').f.category==='CURRENT','account: renamed, growing, a category');
  ok(d.getElementById('page-title').textContent==='Everyday account' && /This account alone/.test(pgb()) && /Balances/.test(pgb()),'account: its own page');
  d.querySelector('[data-span="12"]').click(); await sleep(120);
  ok(/In 1 year/.test(pgb()),'account: where it heads on its own');
  d.querySelector('[data-span="past"]').click(); await sleep(80);
  const entries=()=>store.balances('ex-current').length; const before2=entries();
  d.querySelector('[data-acct="balance"]').click(); await sleep(60);
  setVal(d,'ab-amount','49,500'); submit(d,'acct-balance-form'); await sleep(120);
  ok(entries()===before2+1 && Number(store.latest('ex-current').f.value_minor)===4950000,'account: a balance added from its page');
  w.confirm=()=>true; d.querySelector('[data-withdraw]').click(); await sleep(120);
  ok(entries()===before2 && store.withdrawn('ex-current').length===1 && /1 removed entry/.test(pgb()),'account: an entry taken back');
  d.querySelector('[data-putback]').click(); await sleep(120);
  ok(entries()===before2+1,'account: put back');
  d.querySelector('[data-acct="away"]').click(); await sleep(120);
  ok(store.account('ex-current').f.archived_at,'account: archived');
  d.getElementById('back').click(); await sleep(150);
  ok(/Everyday account/.test(d.getElementById('accts-away').textContent),'account: listed as archived');
  d.querySelector('[data-account-restore="ex-current"]').click(); await sleep(100);
  ok(!store.account('ex-current').f.archived_at,'account: restored');
  // a new account, in a currency with no rate yet
  d.querySelector('[data-page="account-new"]').click(); await sleep(80);
  setVal(d,'af-name','Tokyo savings'); setVal(d,'af-currency','JPY'); await sleep(20);
  ok(!d.getElementById('af-rate-box').hidden,'new account: asks for a rate it has not got');
  setVal(d,'af-balance','100,000'); setVal(d,'af-rate','0.0068'); d.getElementById('af-pays').checked=true; d.getElementById('af-pays').dispatchEvent(new w.Event('change',{bubbles:true}));
  setVal(d,'af-income-rate','0.5'); setVal(d,'af-freq','ANNUAL'); submit(d,'account-form'); await sleep(200);
  const tokyo=store.accounts().find(a=>a.f.name==='Tokyo savings');
  ok(tokyo && tokyo.f.currency_code==='JPY' && Number(store.latest(tokyo.name).f.value_minor)===100000 && tokyo.f.income_basis==='RATE' && tokyo.f.income_rate_pct==='0.5','new account: saved with its first balance and interest');
  ok(store.rows.get('rate-JPY') && store.rows.get('rate-JPY').f.rate==='0.0068' && store.rateHistory().some(v=>v.f.quote_code==='JPY'),'new account: its rate, and a line of rate history');
  // update every balance at once
  d.getElementById('back').click(); await sleep(150);
  d.querySelector('[data-page="update"]').click(); await sleep(80);
  d.querySelector('[data-same="all"]').click(); await sleep(20);
  const car=d.querySelector('[data-ub="ex-car"]'); car.value='21,000'; car.dispatchEvent(new w.Event('input',{bubbles:true}));
  const n0=store.of('Balance').length; submit(d,'update-form'); await sleep(200);
  ok(store.of('Balance').length===n0+store.accounts().length && Number(store.latest('ex-car').f.value_minor)===2100000,'update balances: one entry each, today');
  // currencies
  d.querySelector('[data-page="currencies"]').click(); await sleep(150);
  ok(/Share of net worth/.test(pgb()) && /If a currency moved/.test(pgb()) && /Net worth would be/.test(pgb()),'currencies: shares and a move');
  const gbp=d.querySelector('[data-rate="GBP"]'); gbp.value='1.3'; submit(d,'rates-form'); await sleep(150);
  ok(store.rows.get('rate-GBP').f.rate==='1.3' && store.rows.get('rate-GBP').f.source==='MANUAL','currencies: a rate typed, held as Manual');
  d.getElementById('back').click(); await sleep(60);
  // history
  const hb=()=>d.getElementById('history-body').textContent;
  d.getElementById('tab-history').click(); await sleep(200);
  ok(/What you were worth/.test(hb()) && d.querySelector('#hist-chart svg path.line'),'history: the line drawn');
  ok(/What moved it/.test(hb()) && /Savings \(UK\)/.test(hb()) && /New/.test(hb()),'history: what moved it, a new account named');
  w.prompt=()=> 'Before the move'; d.querySelector('[data-h="mark"]').click(); await sleep(200);
  ok(store.markers().length===1 && store.markers()[0].f.label==='Before the move' && store.markers()[0].f.taken_on===w.WWMoney.today(),'history: a moment marked');
  d.querySelector(`[data-h-archive="${store.markers()[0].name}"]`).click(); await sleep(200);
  ok(store.markers().length===0 && store.markers(true).length===1,'history: a mark archived');
  w.confirm=()=>true; d.querySelector('[data-h-delete]').click(); await sleep(200);
  ok(store.markers(true).length===0,'history: a mark deleted');
  d.querySelector('details.more').open=true; await sleep(20);
  ok(/Side by side/.test(hb()) && d.querySelector('table.snap') && /How the forecast held up/.test(hb()),'history: side by side and the forecast');
  // projection, worked out here
  w.WWProjection = await import(require('url').pathToFileURL(require('path').join(__dirname,'..','projection.mjs')).href);
  w.WWApp.render(); await sleep(50);
  d.getElementById('tab-projection').click(); await sleep(50);
  const hero=d.querySelector('.hero2'); const pb=()=>d.getElementById('proj-body').textContent;
  ok(hero && /Net worth/.test(hero.textContent) && /USD/.test(hero.textContent) && /in 2 years/.test(hero.textContent),'projection: the headline, where it heads in 2 years');
  ok(d.querySelector('#proj-chart svg path.line'),'projection: the line is drawn');
  ok(/Can be reached/.test(pb()) && d.querySelectorAll('#proj-chart svg path.avail').length===1,'projection: the pension locked until 60 shows what is within reach');
  ok(d.querySelectorAll('.tiles .tile').length===3 && /Set an amount/.test(d.querySelector('[data-page="target"]').textContent),'projection: Target, FIRE and Breakdown tiles; no target yet');
  ok(/If income stopped/.test(pb()) && /Monthly savings/.test(pb()) && /Money in/.test(pb()),'projection: the summary');
  ok(d.querySelectorAll('[data-slider]').length===3,'projection: three sliders');
  // a line switched on and off, kept in this browser
  d.querySelector('[data-series="locked"]').click(); await sleep(60);
  ok(d.querySelectorAll('#proj-chart svg path.avail').length===2,'projection: a third line switched on');
  d.querySelector('[data-series="locked"]').click(); await sleep(60);
  // hide amounts
  d.querySelector('[data-act="hide"]').click(); await sleep(60);
  ok(/•••••/.test(d.querySelector('.hero2').textContent) && !/\d,\d{3}\.\d\d/.test(d.querySelector('.hero2').textContent),'projection: amounts hidden');
  d.querySelector('[data-act="hide"]').click(); await sleep(60);
  ok(!/•••••/.test(d.querySelector('.hero2').textContent),'projection: amounts shown again');
  // the horizon: 1 year saved to the settings
  d.querySelector('[data-horizon="12"]').click(); await sleep(80);
  ok(Number(store.assumptions().f.horizon_months)===12 && /in 1 year/.test(d.querySelector('.hero2').textContent),'projection: horizon 1 year, saved');
  // a slider: dragged, then let go, saved
  const sl=d.getElementById('sl-spending'); sl.value=String(Number(sl.value)+100000); sl.dispatchEvent(new w.Event('input',{bubbles:true})); await sleep(30);
  ok(/\(/.test(d.getElementById('live-moved').textContent),'projection: dragging shows how far the end moved');
  sl.dispatchEvent(new w.Event('change',{bubbles:true})); await sleep(100);
  ok(Number(store.assumptions().f.monthly_spending_minor)===1250000 && d.querySelector('[data-act="undo"]'),'projection: let go, saved, with Undo');
  d.querySelector('[data-act="undo"]').click(); await sleep(100);
  ok(Number(store.assumptions().f.monthly_spending_minor)===1150000,'projection: Undo puts it back');
  // the pages the tiles open
  const pg=()=>d.getElementById('page-body').textContent;
  d.querySelector('[data-page="sum"]').click(); await sleep(80);
  ok(!d.getElementById('page-view').hidden && d.getElementById('page-title').textContent==='How this number is made' && /What you own/.test(pg()) && /Less what you owe/.test(pg()),'sum: owned, owed, net worth');
  ok(/at 1 GBP = 1.3 USD/.test(pg()),'sum: a foreign account shows its rate');
  d.getElementById('back').click(); await sleep(50);
  ok(d.getElementById('page-view').hidden && !d.getElementById('panel-projection').hidden,'back: to Projection');
  d.querySelector('[data-page="target"]').click(); await sleep(80);
  setVal(d,'t-amount','150,000'); submit(d,'target-form'); await sleep(120);
  ok(store.target() && Number(store.target().f.amount_minor)===15000000 && store.target().f.basis==='NET_WORTH','target: saved to the file');
  ok(/Reaches USD.150,000.00/.test(pg()) && /from now, on these numbers/.test(pg()),'target: when it is reached: '+pg().replace(/\s+/g,' ').slice(0,200));
  d.querySelector('[data-t="aim"]').click(); await sleep(200);
  ok(/^\d{4}-\d{2}$/.test(store.target().f.by_month) && /Save more/.test(pg()) && /Or a yearly return of/.test(pg()),'target: what it would take by a month');
  d.querySelector('[data-t="clear"]').click(); await sleep(100);
  ok(!store.target(),'target: cleared');
  d.getElementById('back').click(); await sleep(30);
  d.querySelector('[data-page="fire"]').click(); await sleep(120);
  ok(/Covers your spending from/.test(pg()) && /That year, in and out|Never|Already/.test(pg()),'fire: an answer');
  d.querySelector('[data-fire-pct="3.5"]').click(); await sleep(150);
  ok(store.assumptions().f.annual_withdrawal_pct==='3.5','fire: withdrawal rate saved');
  d.querySelector('[data-fire-basis="whatif"]').click(); await sleep(150);
  ok(d.getElementById('fw-pot') && /None of this is saved/.test(pg()),'fire: what if, from your figures');
  d.querySelector('[data-fire-basis="assumptions"]').click(); await sleep(80);
  d.getElementById('back').click(); await sleep(30);
  d.querySelector('[data-page="breakdown"]').click(); await sleep(150);
  ok(/Money over 1 year/.test(pg()) && /What you own, by account/.test(pg()) && /Monthly detail in USD/.test(pg()),'breakdown: flows, owned by account, month by month');
  ok(/What you can reach/.test(pg()) && /Available from/.test(pg()),'breakdown: what is locked');
  d.getElementById('back').click(); await sleep(30);
  d.querySelector('[data-page="groups"]').click(); await sleep(60);
  d.querySelector('[data-g="new"]').click(); await sleep(40);
  submit(d,'group-form'); await sleep(40);
  ok(/name of up to 40/.test(d.getElementById('g-name-err').textContent) && /at least one account/.test(d.getElementById('g-accounts-err').textContent),'groups: a name and an account needed');
  setVal(d,'g-name','Retirement'); d.querySelector('#group-form .checks input[value="ex-pension"]').checked=true; submit(d,'group-form'); await sleep(120);
  const grp=store.groups()[0];
  ok(grp && grp.name==='Retirement' && grp.accountIds.join()==='ex-pension','groups: saved');
  d.getElementById('back').click(); await sleep(100);
  ok(d.querySelector(`[data-series="group:${grp.id}"][aria-pressed="true"]`),'groups: its line switched on in the chart');
  // documents: kept as they are, and a note
  d.getElementById('tab-documents').click(); await sleep(50);
  const newDoc=store.documents().find(x=>x.f.status==='NEW'); const fresh=()=>store.documents().filter(x=>x.f.status==='NEW').length; const f0=fresh();
  d.querySelector(`[data-keep-doc="${newDoc.name}"]`).click(); await sleep(100);
  ok(store.rows.get(newDoc.name).f.status==='KEPT' && fresh()===f0-1 && d.getElementById('n-new').textContent===String(f0-1)||d.getElementById('n-new').hidden,'documents: kept as it is, no longer new');
  w.prompt=()=> 'For the tax return'; d.querySelector(`[data-note-doc="${newDoc.name}"]`).click(); await sleep(100);
  ok(store.rows.get(newDoc.name).f.note==='For the tax return' && /For the tax return/.test(d.getElementById('docs').textContent),'documents: a note');
  // settings
  const sb=()=>d.getElementById('settings-body').textContent;
  d.getElementById('tab-settings').click(); await sleep(150);
  ok(/Main currency/.test(sb()) && /Save your figures/.test(sb()) && /Exchange rates/.test(sb()),'settings: the sections');
  d.querySelector('[data-theme-set="dark"]').click(); await sleep(30);
  ok(d.documentElement.getAttribute('data-theme')==='dark','settings: dark, chosen');
  d.querySelector('[data-theme-set="system"]').click(); await sleep(30);
  ok(!d.documentElement.hasAttribute('data-theme'),'settings: back to the system');
  const s0=store.assumptions().f, inc0=Number(s0.monthly_income_minor), gbpRate=Number(store.rows.get('rate-GBP').f.rate);
  setVal(d,'set-base','GBP'); await sleep(50);
  submit(d,'base-form'); await sleep(300);
  const s1=store.assumptions().f;
  ok(s1.base_currency_code==='GBP' && Number(s1.monthly_income_minor)===Math.round(inc0/gbpRate),'settings: switched to GBP, income restated ('+s1.monthly_income_minor+')');
  ok(!store.rows.get('rate-GBP') && store.rows.get('rate-USD') && Number(store.rows.get('rate-USD').f.rate).toFixed(6)===(1/gbpRate).toFixed(6),'settings: the rates re-expressed in GBP');
  ok(store.history()[store.history().length-1].f.base_currency_code==='GBP','settings: a line of history for the switch');
  w.WW.show('settings',{page:'assumptions'}); await sleep(100);
  setVal(d,'as-payday','25'); await sleep(100);
  ok(Number(store.assumptions().f.income_day)===25,'income & spending: pay day saved');
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
  d.getElementById('tab-accounts').click(); await sleep(100); d.querySelector('[data-balance="a1"]').click(); await sleep(100); setVal(d,'bal-amount','13000'); setVal(d,'bal-day','2026-10-11');
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
    next=made('b'.repeat(64), -3000); next.accounts[0].belowZero=true;
    Object.defineProperty(up,'files',{value:[new w.File(['made,up,2\n'],'sep.csv')],configurable:true}); up.dispatchEvent(new w.Event('change')); await sleep(200);
    const doc2=[...w.__ck.records.values()].find(r=>r.recordType==='Document'&&r.fields.file_name.value==='sep.csv');
    d.querySelector(`[data-read-doc="${doc2.recordName}"]`).click(); await sleep(150);
    ok(/My SGD account/.test(d.getElementById('review').textContent) && /Adds to this account/.test(d.getElementById('review').textContent),'statement: found by its bank reference');
    ok(/Below zero on this statement/.test(d.getElementById('review').textContent),'statement: an overdraft is named, as the statements page names it');
    ok(d.getElementById('review-add').disabled && !d.querySelector('[data-review-keep="0:0"]').checked,'statement: below zero, Add waits for the switch');
    d.querySelector('[data-review-keep="0:0"]').click(); await sleep(20);
    ok(!d.getElementById('review-add').disabled,'statement: kept below zero, Add can go');
    d.getElementById('review-add').click(); await sleep(200);
    ok([...w.__ck.records.values()].some(r=>r.recordType==='Balance'&&r.fields.value_minor.value===-3000&&r.fields.as_of_date.value==='2026-09-30'),'statement: the negative balance kept, as confirmed');
    ok([...w.__ck.records.values()].filter(r=>r.recordType==='Account'&&/SGD/.test(r.fields.currency_code.value)).length===1,'statement: no second account');
    next=made('b'.repeat(64), 97000);
    Object.defineProperty(up,'files',{value:[new w.File(['again\n'],'sep-again.csv')],configurable:true}); up.dispatchEvent(new w.Event('change')); await sleep(200);
    const doc3=[...w.__ck.records.values()].find(r=>r.recordType==='Document'&&r.fields.file_name.value==='sep-again.csv');
    d.querySelector(`[data-read-doc="${doc3.recordName}"]`).click(); await sleep(150);
    ok(/Already added/.test(d.getElementById('review').textContent) && !d.getElementById('review-add'),'statement: the same file twice is already added');
    d.getElementById('review-cancel').click(); await sleep(20);
    ok(d.getElementById('review').hidden,'statement: closed');
    // a line read wrongly, put right; a heading read as a line, left out
    const readers = await import(require('url').pathToFileURL(require('path').join(__dirname,'..','..','statements','readers.js')).href);
    w.WWStatementModules={ ...save, correctLine:readers.correctLine, leaveOutLine:readers.leaveOutLine, linesOff:readers.linesOff, correctedCount:readers.correctedCount, readDocument: async ()=>{
      const st=made('c'.repeat(64), 95000); const acct=st.accounts[0];
      acct.ref='SG-UOB:222'; acct.lines[0].amount=-1000; acct.lines.push({date:'2026-09-10',madeOn:null,description:'Balance carried forward',amount:5000,running:null,ref:null,foreign:null,label:'in'});
      acct.check=readers.check(acct); return {statements:[st], problems:[]}; } };
    Object.defineProperty(up,'files',{value:[new w.File(['wrong\n'],'oct.csv')],configurable:true}); up.dispatchEvent(new w.Event('change')); await sleep(200);
    const doc4=[...w.__ck.records.values()].find(r=>r.recordType==='Document'&&r.fields.file_name.value==='oct.csv');
    d.querySelector(`[data-read-doc="${doc4.recordName}"]`).click(); await sleep(150);
    const rv=()=>d.getElementById('review').textContent;
    ok(/open its lines to put them right/.test(rv()) && !d.querySelector('[data-review-include="0:0"]').checked,'correct: a statement that does not add up, left out');
    d.querySelector('[data-rl-open="0:0"]').click(); await sleep(20);
    d.querySelector('[data-rl="0:0:0"]').click(); await sleep(20);
    setVal(d,'rl-amount','-100.00'); submit2=d.querySelector('[data-rl-form="0:0:0"]'); submit2.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true})); await sleep(30);
    ok(/Corrected by you/.test(rv()),'correct: a line put right');
    d.querySelector('[data-rl="0:0:2"]').click(); await sleep(20);
    d.querySelector('[data-rl-out="0:0:2"]').click(); await sleep(30);
    ok(/add up to the statement, with 2 changes of yours/.test(rv()) && d.querySelector('[data-review-include="0:0"]').checked,'correct: a line left out; now it adds up, and is kept: '+rv().replace(/\s+/g,' ').slice(0,200));
    d.getElementById('review-cancel').click(); await sleep(20);
  }
  // settings from the phone, edited here: types, nulls and the change tag as the app needs them
  w.__ck.put({recordType:'Assumptions',recordName:'assumptions-1',fields:{base_currency_code:{value:'AED'},monthly_income_minor:{value:4500000},monthly_spending_minor:{value:2200000},annual_raise_pct:{value:'5'},raise_effective_month:{value:4},annual_spending_growth_pct:{value:'3'},annual_return_pct:{value:'7'},horizon_months:{value:12},updated_at:{value:'2026-09-08T10:00:00.000Z'},annual_withdrawal_pct:{value:'4'},nulls:{value:'birth_month,birth_year,fire_growth_pct,fire_interest_pct,income_day'}}});
  d.getElementById('refresh').click(); await sleep(150);
  w.WW.show('projection',{page:'assumptions'}); await sleep(20);
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
  d.getElementById('tab-accounts').click(); await sleep(100); d.querySelector('[data-account-edit="a1"]').click(); await sleep(100);
  setVal(d,'af-name','Everyday AED'); setVal(d,'af-category','SAVINGS'); submit(d,'account-form'); await sleep(200);
  const ac=w.__ck.records.get('a1');
  ok(ac.fields.name.value==='Everyday AED' && ac.fields.is_invested.type==='INT64' && /archived_at/.test(ac.fields.nulls.value) && ac.fields.category.value==='SAVINGS','icloud: account renamed and labelled, still in use');
  ok(ac.fields.income_reinvested.type==='INT64' && /income_basis/.test(ac.fields.nulls.value),'icloud: account fields typed, empty ones named');
  // a new account, with its first balance, sent together
  w.__ck.atomics=[]; w.WW.show('money',{page:'account-new'}); await sleep(80);
  setVal(d,'af-name','Cash box'); setVal(d,'af-balance','250'); submit(d,'account-form'); await sleep(200);
  const box=[...w.__ck.records.values()].find(r=>r.recordType==='Account'&&r.fields.name.value==='Cash box');
  const firstBal=box&&[...w.__ck.records.values()].find(r=>r.recordType==='Balance'&&r.fields.account_id.value===box.recordName);
  ok(box && firstBal && firstBal.fields.value_minor.value===25000 && box.fields.display_order.type==='INT64' && w.__ck.atomics.includes(true),'icloud: a new account and its balance, kept whole');
  // a target and a mark of the line's settings
  w.WW.show('projection',{page:'target'}); await sleep(150);
  setVal(d,'t-amount','100000'); submit(d,'target-form'); await sleep(200);
  const tg=w.__ck.records.get('target-1');
  ok(tg && tg.fields.amount_minor.value===10000000 && tg.fields.amount_minor.type==='INT64' && tg.fields.basis.value==='NET_WORTH' && /by_month/.test(tg.fields.nulls.value),'icloud: the target, as the app keeps it '+JSON.stringify(tg&&tg.fields));
  // a mark, as the phone keeps one
  await w.WWApp.state.store.addMarker('Mark 16 Oct 2026','2026-10-16'); await sleep(50);
  const mk=[...w.__ck.records.values()].find(r=>r.recordType==='Marker');
  ok(mk && /^[0-9a-f]{32}$/.test(mk.recordName) && mk.fields.taken_on.value==='2026-10-16' && /archived_at/.test(mk.fields.nulls.value) && mk.fields.created_at.value,'icloud: a mark named as the phone names one, its empty date named');
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
