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
    saveRecords: async (records, opts)=>{
      if(!ck.zone) return {hasErrors:true, errors:[{ckErrorCode:'ZONE_NOT_FOUND'}], records:[]};
      if(ck.failNext){ const c=ck.failNext; ck.failNext=null; return {hasErrors:true, errors:[{ckErrorCode:c, reason:'x'}], records:[]}; }
      return {hasErrors:false, records: records.map(r=>{ ck.lastSaveTag=r.recordChangeTag||null; const copy={...r, recordChangeTag:'tag'+(++counter)};
        if(r.fields.file){ copy.fields={...r.fields, file:{value:{downloadURL:'https://cvws.example/${f}', size:r.fields.file.value.size}}}; ck.records.set(r.recordName,{...copy, fields:{...r.fields}}); }
        else ck.records.set(r.recordName, copy);
        return copy; })};
    },
    deleteRecords: async (list)=>{ list.forEach(r=>ck.records.delete(r.recordName)); return {hasErrors:false, records:list}; },
  };
  const container = { privateCloudDatabase: db,
    setUpAuth: async ()=> signedIn ? {userRecordName:'_u'} : null,
    whenUserSignsIn: ()=> new Promise(r=>inResolvers.push(r)),
    whenUserSignsOut: ()=> new Promise(r=>outResolvers.push(r)) };
  window.CloudKit = { configure(c){ ck.config=c; }, getDefaultContainer(){ return container; } };
})();
