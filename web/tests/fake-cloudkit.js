(function(){
  let signedIn=false, inResolvers=[], outResolvers=[], counter=0;
  const ck = window.__ck = { records:new Map(), zone:false, failNext:null, lastSaveTag:null,
    signIn(){ signedIn=true; inResolvers.splice(0).forEach(r=>r({userRecordName:'_u'})); },
    signOut(){ signedIn=false; outResolvers.splice(0).forEach(r=>r()); },
    put(r){ ck.zone=true; r.recordChangeTag='srv'+(++counter); ck.records.set(r.recordName,r); } };
  const db = {
    saveRecordZones: async (z)=>{ ck.zone=true; return {hasErrors:false, zones:z}; },
    fetchRecordZoneChanges: async (q)=>{ if(!ck.zone) return {hasErrors:true, errors:[{ckErrorCode:'ZONE_NOT_FOUND'}]};
      return {hasErrors:false, zones:[{zoneID:q.zoneID, syncToken:'tok', moreComing:false, records:[...ck.records.values()].map(r=>JSON.parse(JSON.stringify(r)))}]}; },
    saveRecords: async (records, opts)=>{ ck.atomics=(ck.atomics||[]).concat([Boolean(opts&&opts.atomic)]);
      if(!ck.zone) return {hasErrors:true, errors:[{ckErrorCode:'ZONE_NOT_FOUND'}], records:[]};
      if(ck.failAfter!==undefined && ck.failAfter!==null){ if(ck.failAfter===0){ ck.failAfter=null; return {hasErrors:true, errors:[{ckErrorCode:'NETWORK_ERROR', reason:'x'}], records:[]}; } ck.failAfter--; }
      if(ck.failNext){ const c=ck.failNext; ck.failNext=null; return {hasErrors:true, errors:[{ckErrorCode:c, reason:'x'}], records:[]}; }
      return {hasErrors:false, records: records.map(r=>{ ck.lastSaveTag=r.recordChangeTag||null; (ck.sentTags=ck.sentTags||{})[r.recordName]=r.recordChangeTag||null; const copy={...r, recordChangeTag:'tag'+(++counter)};
        if(r.fields.file){ copy.fields={...r.fields, file:{value:{downloadURL:'https://cvws.example/${f}', size:r.fields.file.value.size}}}; ck.records.set(r.recordName,{...copy, fields:{...r.fields}}); }
        else ck.records.set(r.recordName, copy);
        return copy; })};
    },
    newRecordsBatch: (opts)=>{ const items=[]; const add=(op)=>(r)=>{ items.push({op,r}); return b; };
      const b={ create:add('create'), update:add('update'), replace:add('replace'),
        commit: async()=>{ ck.ops=(ck.ops||[]).concat(items.map(i=>i.r.recordType+':'+i.op)); return db.saveRecords(items.map(i=>i.r), opts); } };
      return b; },
    fetchRecords: async (list)=>({hasErrors:false, records:list.map(r=>ck.records.get(r.recordName)).filter(Boolean).map(r=>JSON.parse(JSON.stringify(r)))}),
    deleteRecords: async (list)=>{ list.forEach(r=>ck.records.delete(r.recordName)); return {hasErrors:false, records:list}; },
  };
  const container = { privateCloudDatabase: db,
    setUpAuth: async ()=> signedIn ? {userRecordName:'_u'} : null,
    whenUserSignsIn: ()=> new Promise(r=>inResolvers.push(r)),
    whenUserSignsOut: ()=> new Promise(r=>outResolvers.push(r)) };
  window.CloudKit = { configure(c){ ck.config=c; }, getDefaultContainer(){ return container; } };
})();
