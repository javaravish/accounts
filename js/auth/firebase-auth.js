/* Firebase initialization + authentication + registration/access/profile flows.
   Extracted mechanically from the original file; behavior is unchanged. */

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
    import {
      getAuth,
      onAuthStateChanged,
      signInWithEmailAndPassword,
      createUserWithEmailAndPassword,
      signOut,
      setPersistence,
      browserSessionPersistence,
      deleteUser,
      sendPasswordResetEmail
    } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
    import {
      getFirestore,
      doc,
      getDoc,
      getDocs,
      collection,
      query,
      where,
      setDoc,
      deleteDoc,
      runTransaction
    } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

    const firebaseConfig = {
      apiKey: "AIzaSyCOYqFubFid6igfZAQYJ4UmweZDGjV_TUs",
      authDomain: "vo-shg-accounts.firebaseapp.com",
      projectId: "vo-shg-accounts",
      storageBucket: "vo-shg-accounts.firebasestorage.app",
      messagingSenderId: "362863242858",
      appId: "1:362863242858:web:00fe2cdb4825e3e78be413"
    };

    const app = initializeApp(firebaseConfig);
    const auth = getAuth(app);
    const firestore = getFirestore(app);

    // Authentication is session-only: closing the browser/tab ends the login.
    // A page refresh is also treated as a fresh login and signs the user out.
    const AUTO_LOGOUT_MS = 5 * 60 * 1000;
    let inactivityTimer = null;
    let lastActivityAt = Date.now();
    let isLoggingOutAutomatically = false;

    // Wait briefly for the accounting app to expose its save-before-logout
    // bridge. This is important because the authentication module is loaded
    // before the main accounting script.
    async function saveAppDataBeforeAuthLogout(){
      for(let i=0;i<40 && typeof window.saveAppDataBeforeLogout!=="function";i++){
        await new Promise(resolve=>setTimeout(resolve,50));
      }
      if(typeof window.saveAppDataBeforeLogout==="function"){
        return await window.saveAppDataBeforeLogout();
      }
      return false;
    }

    function isPageRefresh(){
      try{
        const nav = performance.getEntriesByType("navigation")[0];
        return !!nav && nav.type === "reload";
      }catch(e){
        return false;
      }
    }

    async function forceLogoutOnRefresh(){
      if(!isPageRefresh()) return;
      try{
        await signOut(auth);
      }catch(err){
        console.warn("Refresh logout failed:", err);
      }
    }

    function clearInactivityTimer(){
      if(inactivityTimer){
        clearTimeout(inactivityTimer);
        inactivityTimer=null;
      }
    }

    function startInactivityTimer(){
      clearInactivityTimer();
      lastActivityAt=Date.now();
      try{ sessionStorage.setItem("voLastActivityAt", String(lastActivityAt)); }catch(e){}
      inactivityTimer=setTimeout(async()=>{
        if(!currentUser) return;
        const elapsed=Date.now()-lastActivityAt;
        if(elapsed < AUTO_LOGOUT_MS){
          startInactivityTimer();
          return;
        }
        isLoggingOutAutomatically=true;
        try{
          // Keep the session active if cloud saving could not be confirmed.
          const saved=await saveAppDataBeforeAuthLogout();
          if(saved===false){
            console.warn("Automatic logout paused because cloud saving was not confirmed.");
            startInactivityTimer();
            return;
          }
          await signOut(auth);
        }catch(err){
          console.error("Automatic inactivity logout failed:",err);
        }finally{
          isLoggingOutAutomatically=false;
          if(!currentUser) clearInactivityTimer();
        }
      }, AUTO_LOGOUT_MS);
    }

    function registerActivity(){
      if(!currentUser) return;
      lastActivityAt=Date.now();
      try{ sessionStorage.setItem("voLastActivityAt", String(lastActivityAt)); }catch(e){}
      clearTimeout(inactivityTimer);
      inactivityTimer=setTimeout(()=>{
        if(currentUser) registerActivityCheck();
      }, AUTO_LOGOUT_MS);
    }

    async function registerActivityCheck(){
      if(!currentUser) return;
      const elapsed=Date.now()-lastActivityAt;
      if(elapsed >= AUTO_LOGOUT_MS){
        isLoggingOutAutomatically=true;
        try{
          // Keep the session active if cloud saving could not be confirmed.
          const saved=await saveAppDataBeforeAuthLogout();
          if(saved===false){
            console.warn("Automatic logout paused because cloud saving was not confirmed.");
            startInactivityTimer();
            return;
          }
          await signOut(auth);
        }catch(err){ console.error(err); }
        finally{ isLoggingOutAutomatically=false; if(!currentUser) clearInactivityTimer(); }
      }else{
        startInactivityTimer();
      }
    }

    ["click","keydown","pointerdown","touchstart","mousemove","scroll"].forEach(evt=>{
      window.addEventListener(evt, registerActivity, {passive:true});
    });

    // Set Firebase Auth persistence to the current browser tab/session.
    // This automatically logs out when the tab/browser session is closed.
    setPersistence(auth, browserSessionPersistence).catch(err=>{
      console.warn("Could not set session-only authentication persistence:",err);
    });

    forceLogoutOnRefresh();

    let currentUser = null;
    let activeMode = "VO";
    let accountAccess = {VO:false,MS:false,SHG:false};
    let cloudLoaded = false;
    let saveTimer = null;
    let pendingCloudSave = null;
    let saveQueue = Promise.resolve();
    const syncedRecordsByMode = new Map();
    const chunkedStorageReadyModes = new Set();
    let presenceTimer = null;

    function userDocRef(){
      if(!currentUser) return null;
      return doc(firestore, "users", currentUser.uid);
    }

    async function updatePresence(isOnline, writeLogin){
      if(!currentUser) return;
      const payload={
        presence:{
          online:!!isOnline,
          lastSeenAt:new Date().toISOString()
        },
        updatedAt:new Date().toISOString()
      };
      if(writeLogin) payload.lastLoginAt=new Date().toISOString();
      try{
        await setDoc(userDocRef(),payload,{merge:true});
      }catch(err){
        console.warn("Presence update failed:",err);
      }
    }

    function startPresenceHeartbeat(writeLogin){
      if(presenceTimer)clearInterval(presenceTimer);
      updatePresence(true,writeLogin);
      presenceTimer=setInterval(()=>{
        if(currentUser && document.visibilityState!=="hidden") updatePresence(true,false);
      },30000);
    }

    function stopPresenceHeartbeat(){
      if(presenceTimer){clearInterval(presenceTimer);presenceTimer=null;}
      if(currentUser) updatePresence(false,false);
    }

    async function ensureAccountLookupForUser(user, cloudData){
      if(!user)return;

      const profile=(cloudData&&cloudData.profile)||{};
      const email=String(profile.email||user.email||"").trim();
      if(!email)return;

      const username=String(profile.username||"").trim();

      try{
        const ref=doc(firestore,"accountLookup","email_"+email.toLowerCase());
        await setDoc(ref,{
          uid:user.uid,
          email,
          username
        },{merge:true});

        if(username){
          const usernameRef=doc(firestore,"usernames",username.toLowerCase());
          const usernameSnap=await getDoc(usernameRef);

          if(!usernameSnap.exists()){
            await setDoc(usernameRef,{
              uid:user.uid,
              email
            },{merge:false});
          }
        }
      }catch(err){
        console.warn("Could not repair account lookup:",err);
      }
    }

    async function migrateAccountIndexes(user, cloudData){
      if(!user || !cloudData || !cloudData.profile)return;

      const profile=cloudData.profile;
      const usernameKey=String(profile.username||"").trim().toLowerCase();
      const email=String(profile.email||user.email||"").trim();
      if(!usernameKey && !email)return;

      try{
        const db=firestore;

        // Create the username reservation for older accounts only when the
        // username document does not already belong to someone else.
        if(usernameKey){
          const usernameRef=doc(db,"usernames",usernameKey);
          const usernameSnap=await getDoc(usernameRef);

          if(!usernameSnap.exists()){
            try{
              await setDoc(usernameRef,{uid:user.uid,email},{merge:false});
            }catch(e){
              console.warn("Could not migrate username index:",e);
            }
          }
        }

        // Create the email lookup used by Forgot Password.
        if(email){
          const emailRef=doc(db,"accountLookup","email_"+email.toLowerCase());
          const emailSnap=await getDoc(emailRef);
          if(!emailSnap.exists()){
            try{
              await setDoc(emailRef,{
                uid:user.uid,
                email,
                username:String(profile.username||"")
              },{merge:false});
            }catch(e){
              console.warn("Could not migrate email lookup:",e);
            }
          }
        }
      }catch(e){
        console.warn("Account index migration skipped:",e);
      }
    }

    function cleanFirestoreValue(value, inArray=false){
      // Firestore rejects undefined values (often reported as invalid-argument).
      // Normalize the in-memory record without changing the app's live data.
      if(value === undefined || typeof value === "function" || typeof value === "symbol") return inArray ? null : undefined;
      if(value === null || typeof value === "string" || typeof value === "boolean") return value;
      if(typeof value === "number") return Number.isFinite(value) ? value : null;
      if(value instanceof Date) return value.toISOString();
      if(Array.isArray(value)) return value.map(item=>cleanFirestoreValue(item,true));
      if(typeof value === "object"){
        const out={};
        Object.keys(value).forEach(key=>{
          const cleaned=cleanFirestoreValue(value[key],false);
          if(cleaned!==undefined) out[key]=cleaned;
        });
        return out;
      }
      return null;
    }

    function cloudSafeRecord(record){
      const cleaned=cleanFirestoreValue(record);
      if(!cleaned || typeof cleaned!=="object" || Array.isArray(cleaned)){
        throw new Error("A record could not be prepared for Firebase saving.");
      }
      return cleaned;
    }

    function recordDocumentId(record,index){
      let id=String(record?.id ?? `record_${index}`).replace(/\//g,"_");
      if(!id || id==="." || id===".." || /^__.*__$/.test(id)) id=`record_${index}`;
      // Keep Firestore document IDs bounded and free of path separators.
      if(id.length>900) id=id.slice(0,850)+"_"+String(index);
      return id;
    }

    /*
     * Compact only the Firebase copy of a record. The live app database is
     * never modified, so the existing UI, calculations, local recovery, and
     * PDF code continue to receive the full record shape.
     *
     * Financial month fields omitted here are reconstructed by the existing
     * app calculation flow (missing numeric inputs already read as zero).
     */
    const DERIVED_MONTH_FIELDS = new Set([
      "demandInterest",       // Current Month Interest
      "balancePrincipal",     // Previous + Current Principal
      "balanceInterest",      // Previous + Current Interest
      "totalCollection",
      "totalLoanBalance",     // Closing Loan Balance
      "currentMonthInterest",
      "previousCurrentPrincipal",
      "previousAndCurrentPrincipal",
      "previousCurrentInterest",
      "previousAndCurrentInterest",
      "closingLoanBalance"
    ]);
    const ZERO_PRUNABLE_MONTH_FIELDS = new Set([
      "opening", "prevPrincipal", "prevInterest", "demandPrincipal",
      "demandInterest", "principalCollection", "interestCollection",
      "newLoan", "savingOpening", "savingCurrent", "savingDisbursed",
      "balancePrincipal", "balanceInterest", "totalCollection",
      "totalLoanBalance", "currentMonthInterest",
      "previousCurrentPrincipal", "previousAndCurrentPrincipal",
      "previousCurrentInterest", "previousAndCurrentInterest",
      "closingLoanBalance"
    ]);

    function isAprilMonthKey(key){
      return /^Apr(?:il)?(?:-|$)/i.test(String(key||""));
    }

    function isEmptyFinancialMonth(month){
      if(!month || typeof month!=="object" || Array.isArray(month)) return false;
      const sourceFields=[
        "opening","prevPrincipal","prevInterest","demandPrincipal",
        "principalCollection","interestCollection","newLoan",
        "savingOpening","savingCurrent","savingDisbursed"
      ];
      const hasFinancialInput=sourceFields.some(key=>{
        const value=month[key];
        // A string "0" collection is intentional input in this app and makes
        // the month reportable, so preserve it.
        if((key==="principalCollection" || key==="interestCollection") &&
           typeof value==="string" && value.trim()!=="") return true;
        return value!==undefined && value!==null && value!=="" &&
          !(typeof value==="number" && value===0) &&
          !(typeof value==="string" && Number(value)===0);
      });
      return !hasFinancialInput && month.demandPrincipalManual!==true;
    }

    function compactMonthData(month, monthKey){
      if(!month || typeof month!=="object" || Array.isArray(month)) return month;
      const out={};
      Object.keys(month).forEach(key=>{
        if(DERIVED_MONTH_FIELDS.has(key)) return;
        // From May onward these values are carried/calculated from previous
        // months, not independent source inputs.
        if(!isAprilMonthKey(monthKey) &&
           ["opening","prevPrincipal","prevInterest"].includes(key)) return;
        const value=month[key];
        if(ZERO_PRUNABLE_MONTH_FIELDS.has(key) &&
           (value===0 || value===null || value===undefined ||
            (typeof value==="string" && value.trim()===""))){
          // A manually established zero principal is a meaningful month
          // baseline in the existing report/forward-propagation logic.
          if((key==="principalCollection" || key==="interestCollection") && value===0){
            // Explicit numeric zero is also a valid entered collection in
            // older/imported records; preserve it to keep report eligibility.
            out[key]=value;
          }else if(key==="demandPrincipal" && month.demandPrincipalManual===true && value===0){
            out[key]=value;
          }
          return;
        }
        // Keep explicit string "0" collections: they mean entered zero, not
        // a blank cell, and are used to decide whether a month is reportable.
        if((key==="principalCollection" || key==="interestCollection") &&
           typeof value==="string" && value.trim()==="0"){
          out[key]=value;
          return;
        }
        out[key]=value;
      });
      return out;
    }

    function compactCloudRecord(record){
      const copy=cloudSafeRecord(record);
      function visit(value){
        if(!value || typeof value!=="object") return value;
        if(Array.isArray(value)) return value.map(visit);
        const out={};
        Object.keys(value).forEach(key=>{
          const child=value[key];
          if(key==="months" && child && typeof child==="object" && !Array.isArray(child)){
            const months={};
            Object.keys(child).forEach(monthKey=>{
              const compacted=compactMonthData(child[monthKey],monthKey);
              if(!isEmptyFinancialMonth(compacted)) months[monthKey]=visit(compacted);
            });
            out[key]=months;
            return;
          }
          // A member's display name is stored once on the master member/SHG.
          // ensureLoanData() repopulates each loan.name from member.name.
          if(key==="loans" && child && typeof child==="object" && !Array.isArray(child)){
            const loans={};
            Object.keys(child).forEach(loanKey=>{
              const loan=visit(child[loanKey]);
              if(loan && typeof loan==="object") delete loan.name;
              loans[loanKey]=loan;
            });
            out[key]=loans;
            return;
          }
          out[key]=visit(child);
        });
        return out;
      }
      return visit(copy);
    }

    function restoreCloudRecord(record){
      if(!record || !Array.isArray(record.shgs)) return record;
      record.shgs.forEach(member=>{
        if(!member || typeof member!=="object") return;
        if(member.loans && typeof member.loans==="object"){
          Object.values(member.loans).forEach(loan=>{
            if(loan && typeof loan==="object" && !loan.name && member.name){
              loan.name=member.name;
            }
          });
        }
      });
      return record;
    }

    function recordMapForDb(db){
      const map=new Map();
      const vos=Array.isArray(db?.vos)?db.vos:[];
      vos.forEach((record,index)=>{
        const safeRecord=compactCloudRecord(record);
        let id=recordDocumentId(safeRecord,index);
        if(map.has(id)) id=`${id}_${index}`;
        map.set(id,{record:safeRecord,json:JSON.stringify(safeRecord)});
      });
      return map;
    }

    function setSyncedSnapshot(mode, recordMap){
      syncedRecordsByMode.set(mode,new Map(Array.from(recordMap,([id,item])=>[id,item.json])));
    }

    async function loadCloudDb(mode){
      if(!currentUser) return null;

      /*
       * Prefer the per-record layout. If it exists, retain a baseline so later
       * saves can write only changed records and remove deleted records.
       */
      try{
        const recordsRef=collection(firestore,"users",currentUser.uid,"modeData",mode,"records");
        const recordsSnap=await getDocs(recordsRef);
        if(!recordsSnap.empty){
          const vos=[];
          const chunkGroups=new Map();
          recordsSnap.forEach(s=>{
            const d=s.data()||{};
            if(d._chunkedRecord===true && Number.isInteger(d.totalParts)){
              const group=chunkGroups.get(s.id)||{manifest:null,parts:new Array(d.totalParts)};
              group.manifest=d;
              if(group.parts.length!==d.totalParts) group.parts.length=d.totalParts;
              chunkGroups.set(s.id,group);
            }else if(typeof d.dataChunk==="string" && d._chunkPart===true){
              const group=chunkGroups.get(d.originalId)||{manifest:null,parts:new Array(d.totalParts||0)};
              if(d.partIndex>=0) group.parts[d.partIndex]=d.dataChunk;
              chunkGroups.set(d.originalId,group);
            }else if(d.data){
              vos.push(restoreCloudRecord(d.data));
            }
          });
          // Reassemble oversized records from sibling documents. The manifest
          // is stored at the original record ID, preserving app-level IDs.
          chunkGroups.forEach((group,id)=>{
            if(!group.manifest || !Number.isInteger(group.manifest.totalParts)) return;
            const parts=group.parts;
            if(parts.length!==group.manifest.totalParts || parts.some(part=>typeof part!=="string")) {
              throw new Error("An oversized cloud record is incomplete: "+id);
            }
            const record=restoreCloudRecord(JSON.parse(parts.join("")));
            vos.push(record);
          });
          vos.sort((a,b)=>String(a.id||"").localeCompare(String(b.id||"")));
          if(vos.length){
            const loaded={vos};
            setSyncedSnapshot(mode,recordMapForDb(loaded));
            chunkedStorageReadyModes.add(mode);
            return loaded;
          }
        }
      }catch(err){
        console.warn("Chunked cloud load unavailable; trying legacy storage:",err);
      }

      /* Backward compatibility with the existing single-document layout. */
      const snap = await getDoc(userDocRef());
      if(!snap.exists()){
        syncedRecordsByMode.set(mode,new Map());
        chunkedStorageReadyModes.delete(mode);
        return null;
      }
      const data = snap.data()||{};
      const field = mode === "MS" ? "msData" : (mode === "SHG" ? "shgData" : "voData");
      let legacy=null;
      if(data[field] && Array.isArray(data[field].vos)) legacy=data[field];
      else if(mode === "VO" && Array.isArray(data.vos)) legacy={vos:data.vos};
      if(legacy){
        legacy.vos.forEach(restoreCloudRecord);
        // Do not treat a legacy document as record-level storage. The first
        // successful save migrates the complete dataset before diffing saves.
        syncedRecordsByMode.set(mode,new Map());
        chunkedStorageReadyModes.delete(mode);
        return legacy;
      }
      syncedRecordsByMode.set(mode,new Map());
      chunkedStorageReadyModes.delete(mode);
      return null;
    }


    function isFirestoreDocumentTooLarge(err){
      const code=String(err?.code||"").toLowerCase();
      const message=String(err?.message||err||"");
      return code.includes("resource-exhausted") || /1\\s*MiB|1048576|maximum.*size|document.*too large|exceeds.*maximum/i.test(message);
    }

    async function runWithConcurrency(items,limit,worker){
      let next=0;
      const count=Math.min(Math.max(1,limit),items.length);
      await Promise.all(Array.from({length:count},async()=>{
        while(next<items.length){
          const index=next++;
          await worker(items[index],index);
        }
      }));
    }

    // Firestore has a 1 MiB document limit. Keep each text piece well below
    // that limit to allow for metadata and UTF-8 expansion.
    const FIRESTORE_RECORD_CHUNK_CHARS = 180000;

    function splitRecordJson(json){
      const parts=[];
      for(let i=0;i<json.length;i+=FIRESTORE_RECORD_CHUNK_CHARS){
        parts.push(json.slice(i,i+FIRESTORE_RECORD_CHUNK_CHARS));
      }
      return parts;
    }

    function expectedRecordDocumentIds(id,json){
      if(json.length<=FIRESTORE_RECORD_CHUNK_CHARS) return [id];
      const parts=splitRecordJson(json);
      return [id,...parts.map((_,index)=>`${id}__part_${index}`)];
    }

    async function writeRecordSafely(recordsRef,item,uid,mode){
      const ref=doc(recordsRef,item.id);
      const updatedAt=new Date().toISOString();
      if(item.json.length<=FIRESTORE_RECORD_CHUNK_CHARS){
        await setDoc(ref,{data:item.record,ownerUid:uid,mode,updatedAt},{merge:false});
        const oldJson=(syncedRecordsByMode.get(mode)||new Map()).get(item.id)||"";
        const oldParts=oldJson.length>FIRESTORE_RECORD_CHUNK_CHARS
          ? Math.ceil(oldJson.length/FIRESTORE_RECORD_CHUNK_CHARS) : 0;
        const stale=[];
        for(let i=0;i<oldParts;i++) stale.push(doc(recordsRef,`${item.id}__part_${i}`));
        if(stale.length) await runWithConcurrency(stale,6,partRef=>deleteDoc(partRef));
        return;
      }

      const parts=splitRecordJson(item.json);
      // Write parts first, then the manifest. Readers only accept a chunked
      // record when its manifest and every part are present.
      await runWithConcurrency(parts,6,async(part,index)=>{
        await setDoc(doc(recordsRef,`${item.id}__part_${index}`),{
          _chunkPart:true,originalId:item.id,partIndex:index,totalParts:parts.length,
          dataChunk:part,ownerUid:uid,mode,updatedAt
        },{merge:false});
      });
      await setDoc(ref,{
        _chunkedRecord:true,totalParts:parts.length,ownerUid:uid,mode,updatedAt
      },{merge:false});

      // If this record used to have more chunks, remove the now-obsolete tail.
      const previousParts=Number((syncedRecordsByMode.get(mode)||new Map()).get(item.id)?.length||0)>FIRESTORE_RECORD_CHUNK_CHARS
        ? Math.ceil((syncedRecordsByMode.get(mode)||new Map()).get(item.id).length/FIRESTORE_RECORD_CHUNK_CHARS) : 0;
      const stale=[];
      for(let i=parts.length;i<previousParts;i++) stale.push(doc(recordsRef,`${item.id}__part_${i}`));
      if(stale.length) await runWithConcurrency(stale,6,ref=>deleteDoc(ref));
    }

    async function saveCloudDbChunked(db,mode){
      if(!currentUser) return false;
      const uid=currentUser.uid;
      const recordsRef=collection(firestore,"users",uid,"modeData",mode,"records");
      const currentRecords=recordMapForDb(db);
      const baseline=syncedRecordsByMode.get(mode)||new Map();
      const needsMigration=!chunkedStorageReadyModes.has(mode);
      const changed=[];

      currentRecords.forEach((item,id)=>{
        if(needsMigration || baseline.get(id)!==item.json) changed.push({id,...item});
      });

      // Write independent records concurrently with a modest limit. Keep the
      // baseline unchanged until every write succeeds, so failed writes retry.
      await runWithConcurrency(changed,4,item=>writeRecordSafely(recordsRef,item,uid,mode));

      const deleted=[];
      if(needsMigration){
        // One-time migration: remove stale documents only after all records,
        // including every oversized-record part, have been written.
        const expectedIds=new Set();
        currentRecords.forEach((item,id)=>expectedRecordDocumentIds(id,item.json).forEach(docId=>expectedIds.add(docId)));
        const existing=await getDocs(recordsRef);
        existing.forEach(s=>{if(!expectedIds.has(s.id))deleted.push(s.ref);});
      }else{
        baseline.forEach((oldJson,id)=>{
          if(!currentRecords.has(id)){
            expectedRecordDocumentIds(id,oldJson).forEach(docId=>deleted.push(doc(recordsRef,docId)));
          }
        });
      }
      if(deleted.length){
        await runWithConcurrency(deleted,6,ref=>deleteDoc(ref));
      }

      if(currentUser?.uid!==uid) return false;
      setSyncedSnapshot(mode,currentRecords);
      chunkedStorageReadyModes.add(mode);
      return true;
    }

    function describeCloudSaveError(err){
      const code=String(err?.code||'').replace(/^firebase\\./,'');
      const message=String(err?.message||err||'Unknown Firebase error');
      if(code.includes('permission-denied')){
        return `Firebase rejected the cloud save (permission-denied). Your internet is working, but the Firestore security rules are not allowing this account to write this data.\\n\\nDetails: ${message}`;
      }
      if(code.includes('invalid-argument')){
        return `Firebase rejected one or more data values (invalid-argument). Undefined values are cleaned before upload; check the browser console for the exact field or document details.\\n\\nDetails: ${message}`;
      }
      if(code.includes('resource-exhausted') || /1 MiB|1048576|maximum.*size|document.*too large/i.test(message)){
        return `Firebase rejected the cloud save because a single record is too large.\\n\\nDetails: ${message}`;
      }
      if(code.includes('unauthenticated')){
        return `The Firebase login session is no longer authenticated. Please sign out, sign in again, and save again.\\n\\nDetails: ${message}`;
      }
      if(code.includes('unavailable') || code.includes('deadline-exceeded') || /network|offline|failed to fetch/i.test(message)){
        return `Firebase could not reach the cloud service. Your general internet connection can still be working; this can be a Firebase/network request problem. Please wait a moment and try Save All again.\\n\\nDetails: ${message}`;
      }
      return `Cloud synchronization failed even though the data was saved locally.\\n\\nFirebase error${code ? ` (${code})` : ''}: ${message}`;
    }

    function saveCloudDb(db,mode){
      // Never report a successful save when Firebase Auth is not ready.
      // A false return was previously treated as "Saved" by the debounced UI.
      if(!currentUser) return Promise.reject(new Error("No active Firebase user. Sign in again before saving to Firebase."));
      const saveMode=mode||activeMode;
      // A direct/manual save supersedes the debounce timer for the same mode.
      if(pendingCloudSave && pendingCloudSave.mode===saveMode){
        clearTimeout(saveTimer);
        pendingCloudSave=null;
      }
      // Snapshot immediately so later edits cannot mutate a queued operation.
      let snapshot;
      try{
        snapshot=cleanFirestoreValue(db);
      }catch(err){
        return Promise.reject(err);
      }
      const uid=currentUser.uid;
      const run=async()=>{
        if(!currentUser || currentUser.uid!==uid) throw new Error("Your login session changed before the cloud save completed.");
        const result = await saveCloudDbChunked(snapshot,saveMode);
        if(result !== true) throw new Error("Firebase did not confirm the save. The data may still exist only in this browser; please sign in again and retry.");
        return true;
      };
      const task=saveQueue.then(run,run);
      saveQueue=task.catch(()=>{});
      return task;
    }

    function queueCloudSave(db,localSaved=true,localError=null){
      if(!currentUser || !cloudLoaded){
        const status=document.getElementById("saveStatus");
        if(status){
          status.textContent=localSaved?"Saved locally only. Cloud save unavailable (not signed in or cloud not loaded).":"Save failed locally; cloud save unavailable.";
          status.title=localError?String(localError.message||localError):"No active Firebase session or cloud data is not loaded.";
        }
        return;
      }
      pendingCloudSave={db:cleanFirestoreValue(db),mode:activeMode,localSaved:localSaved!==false,localError};
      clearTimeout(saveTimer);
      const queued=pendingCloudSave;
      saveTimer=setTimeout(async()=>{
        if(pendingCloudSave!==queued) return;
        pendingCloudSave=null;
        const el=document.getElementById("saveStatus");
        if(el) el.textContent="Saving locally and to cloud…";
        try{
          await saveCloudDb(queued.db,queued.mode);
          const status=document.getElementById("saveStatus");
          if(status){
            status.textContent=queued.localSaved
              ?"Saved locally and to cloud."
              :"Saved to cloud only. Local save failed.";
            status.title=!queued.localSaved && queued.localError
              ?`Local storage error: ${String(queued.localError.message||queued.localError)}`:"";
          }
        }catch(err){
          console.error("Firebase auto-save failed:",err);
          const status=document.getElementById("saveStatus");
          if(status){
            status.textContent=queued.localSaved
              ?"Saved locally only. Cloud save failed."
              :"Save failed locally and in cloud.";
            const localDetails=queued.localSaved?"":"\n\nLocal storage error: "+String(queued.localError?.message||queued.localError||"Unknown local storage error");
            status.title=describeCloudSaveError(err)+localDetails;
          }
        }
      },700);
    }

    // Flush the latest screen/database snapshot before logout. saveCloudDb uses
    // the per-record baseline, so this becomes a no-op if already synchronized.
    async function saveNowBeforeLogout(db){
      clearTimeout(saveTimer);
      pendingCloudSave=null;
      if(!currentUser || !cloudLoaded) return false;
      const el=document.getElementById("saveStatus");
      if(el) el.textContent="Saving…";
      try{
        await saveCloudDb(db,activeMode);
        const localState=window.__appLocalSaveState;
        if(el) el.textContent=(localState&&localState.ok===false)
          ?"Saved to cloud only. Local save failed."
          :"Saved locally and to cloud.";
        return !(localState&&localState.ok===false);
      }catch(err){
        if(el){
          const localState=window.__appLocalSaveState;
          el.textContent=(localState&&localState.ok===false)
            ?"Save failed locally and in cloud."
            :"Saved locally only. Cloud save failed.";
          const localDetails=(localState&&localState.ok===false)
            ?"\n\nLocal storage error: "+String(localState.error?.message||localState.error||"Unknown local storage error"):"";
          el.title=describeCloudSaveError(err)+localDetails;
        }
        throw err;
      }
    }

    async function readAccountAccess(user){
      const snap=await getDoc(doc(firestore,"users",user.uid));
      const data=snap.exists()?(snap.data()||{}):{};
      const access=data.access||{};
      // IMPORTANT: do not auto-grant access to a newly authenticated account.
      // Request Access creates the Firebase Auth account first, but the requested
      // VO/MS/SHG flag remains false until the administrator approves it.
      if(["MS","SHG","VO"].some(k=>access[k]===true)) return {
        VO:access.VO===true,MS:access.MS===true,SHG:access.SHG===true
      };
      return {VO:false,MS:false,SHG:false};
    }

    async function registerSystemAccess(mode){
      if(!currentUser || !["VO","MS","SHG"].includes(mode)) throw new Error("Invalid system.");
      throw new Error("Additional system access requires administrator approval. Please use Request Access.");
    }

    function userScopedStorageKey(mode){
      const bases={
        VO:"vo_shg_accounting_v18",
        MS:"ms_shg_accounting_v18",
        SHG:"shg_member_accounting_v18"
      };
      const uid=window.firebaseCloud?.currentUser?.uid||"anonymous";
      return (bases[mode]||bases.VO)+"__user_"+uid;
    }

    async function enterAccountingMode(mode){
      if(!accountAccess[mode]) throw new Error("This account is not registered for "+mode+".");
      activeMode=mode;
      cloudLoaded=false;
      const cloud=await loadCloudDb(mode);
      // Local browser storage is strictly scoped to the Firebase UID and system.
      // NEVER use the old shared mode key here: localStorage is shared by every
      // user who uses the same browser/device and could otherwise expose one
      // user's VO/MS/SHG data to another user.
      const localKey = userScopedStorageKey(mode);
      const localRaw=localStorage.getItem(localKey);
      const localDb=localRaw ? (()=>{try{return JSON.parse(localRaw)}catch(e){return {vos:[]}}})() : {vos:[]};
      let initial=cloud||{vos:[]};

      // Cloud data is authoritative. If this UID has no cloud data yet, start
      // this user's system empty. Do NOT import any legacy/global localStorage
      // data because that data may belong to a different Firebase user.
      if(!cloud && localDb && Array.isArray(localDb.vos) && localDb.vos.length){
        initial=localDb;
      }
      if(!cloud){
        const initialSave = await saveCloudDb(initial,mode);
        if(initialSave !== true) throw new Error("Firebase did not confirm initial cloud storage. Please check your connection and Firestore permissions, then sign in again.");
      }
      window.dispatchEvent(new CustomEvent("firebase-cloud-ready",{detail:{db:initial,hasCloud:!!cloud,mode}}));
      cloudLoaded=true;
      const loginScreen=document.getElementById("loginScreen");
      const appShell=document.getElementById("appShell");
      if(loginScreen)loginScreen.classList.add("hidden");
      if(appShell)appShell.classList.remove("hidden");

      // Every login starts on the main page with the Report Center CLOSED.
      // Reports must only appear after the user explicitly clicks Show Reports.
      const reportSection=document.getElementById("reportCenterSection");
      if(reportSection)reportSection.classList.add("hidden");
      const reportPreview=document.getElementById("reportPreview");
      if(reportPreview){reportPreview.innerHTML="";reportPreview.classList.add("hidden");}
      const reportDownloads=document.getElementById("reportDownloadActions");
      if(reportDownloads)reportDownloads.classList.add("hidden");
      const reportToggle=document.getElementById("showReportsBtn");
      if(reportToggle)reportToggle.textContent="Show Reports";
      document.querySelectorAll("#reportCenterSection .report-type-actions button").forEach(btn=>btn.classList.remove("report-selected"));

      const modal=document.getElementById("systemSelectModal");
      if(modal)modal.classList.add("hidden");
      return true;
    }

    function showSystemSelector(access){
      const modal=document.getElementById("systemSelectModal");
      const box=document.getElementById("systemSelectActions");
      if(!modal||!box)return;
      box.innerHTML="";
      ["VO","MS","SHG"].forEach(mode=>{
        if(!access[mode])return;
        const b=document.createElement("button");
        b.type="button"; b.className="primary";
        b.textContent=mode === "VO" ? "Open VO → SHG" : (mode === "MS" ? "Open MS → VO" : "Open SHG → Member");
        b.onclick=()=>enterAccountingMode(mode).catch(err=>{const m=document.getElementById("systemSelectMsg");if(m){m.textContent=err.message||"Unable to open system.";m.className="auth-msg error";}});
        box.appendChild(b);
      });
      modal.classList.remove("hidden");
    }

    window.firebaseCloud = {
      get currentUser(){ return currentUser; },
      get cloudLoaded(){ return cloudLoaded; },
      get activeMode(){ return activeMode; },
      get accountAccess(){ return {...accountAccess}; },
      getAccountAccess: ()=>({...accountAccess}),
      registerSystemAccess,
      enterAccountingMode,
      signIn: (email,password)=>signInWithEmailAndPassword(auth,email,password),
      signUp: (email,password)=>createUserWithEmailAndPassword(auth,email,password),
      deleteCurrentUser: ()=>currentUser ? deleteUser(currentUser) : Promise.resolve(),
      logout: async()=>{ await updatePresence(false,false); return signOut(auth); },
      sendPasswordResetEmail: (email)=>sendPasswordResetEmail(auth,email),

      // Firestore helpers used by Profile, username lookup and account creation.
      getFirestore: ()=>firestore,
      doc,
      getDoc,
      getDocs,
      collection,
      query,
      where,
      setDoc,
      deleteDoc,
      runTransaction,

      loadCloudDb,
      saveCloudDb,
      queueCloudSave,
      saveNowBeforeLogout,
      describeCloudSaveError,
      setCloudLoaded(v){cloudLoaded=!!v;},
      showAccountingSystemSelector:()=>showSystemSelector(accountAccess)
    };
    window.showAccountingSystemSelector=()=>showSystemSelector(accountAccess);

    document.addEventListener("visibilitychange",()=>{
      if(!currentUser)return;
      if(document.visibilityState==="hidden") updatePresence(false,false);
      else updatePresence(true,false);
    });

    window.addEventListener("beforeunload",()=>{
      if(currentUser) updatePresence(false,false);
    });

    onAuthStateChanged(auth, async(user)=>{
      currentUser=user||null;

      // Request Access is a two-step flow: Firebase Auth must remain signed in
      // long enough for submitAccessRequest() to create the accessRequests
      // document.  Do NOT sign the user out here.  The previous version did
      // that immediately, so the following Firestore setDoc() ran after Auth
      // had already been cleared and returned "Missing or insufficient
      // permissions".  submitAccessRequest() signs out only AFTER the request
      // has been successfully written.
      if(user && sessionStorage.getItem("accessRequestInProgress")==="1"){
        return;
      }

      if(!user){
        stopPresenceHeartbeat();
        sessionStorage.removeItem("accessRequestInProgress");
        clearInactivityTimer();
        cloudLoaded=false;
        accountAccess={VO:false,MS:false,SHG:false};
        const loginScreen=document.getElementById("loginScreen");
        const appShell=document.getElementById("appShell");
        if(loginScreen)loginScreen.classList.remove("hidden");
        if(appShell)appShell.classList.add("hidden");
        const loggedInAs=document.getElementById("loggedInAs");
        if(loggedInAs)loggedInAs.textContent="Logged in As : —";
        window.__adminAuthorized=false;
        const adminNavBtn=document.getElementById("adminNavBtn");
        if(adminNavBtn)adminNavBtn.classList.add("hidden");
        const adminSection=document.getElementById("adminSection");
        if(adminSection)adminSection.classList.add("hidden");
        const selector=document.getElementById("systemSelectModal");
        if(selector)selector.classList.add("hidden");
        return;
      }

      startInactivityTimer();
      const loginScreen=document.getElementById("loginScreen");
      const appShell=document.getElementById("appShell");
      const loginError=document.getElementById("loginError");
      const loggedInAs=document.getElementById("loggedInAs");
      if(loggedInAs)loggedInAs.textContent="Logged in As : "+(user.email||"");

      try{
        accountAccess=await readAccountAccess(user);
        startPresenceHeartbeat(true);
        try{
          const profileSnap=await window.firebaseCloud.getDoc(
            window.firebaseCloud.doc(window.firebaseCloud.getFirestore(),"users",user.uid)
          );
          const profileData=profileSnap.exists()?(profileSnap.data()||{}):{};
          const profile=profileData.profile||{};
          if(loggedInAs)loggedInAs.textContent="Logged in As : "+String(profile.name||user.displayName||user.email||"");

          // Admin navigation is decided from the freshly loaded Firestore
          // profile.  This avoids the race where the Admin module checks
          // before the authentication/profile flow has finished loading.
          const adminNavBtn=document.getElementById("adminNavBtn");
          const isAdminUser=String(profile.role||"").trim().toLowerCase()==="admin" ||
            String(profile.username||"").trim().toLowerCase()==="chary";
          window.__adminAuthorized=!!isAdminUser;
          if(adminNavBtn)adminNavBtn.classList.toggle("hidden",!isAdminUser);
        }catch(nameErr){
          console.warn("Could not load logged-in name:",nameErr);
        }

        // Migrate older accounts: keep username/email indexes and make VO access explicit.
        try{
          const currentCloud=await loadCloudDb("VO");
          if(currentCloud){
            await migrateAccountIndexes(user,currentCloud);
            await ensureAccountLookupForUser(user,currentCloud);
          }
        }catch(indexErr){ console.warn("Account index migration failed:",indexErr); }

        const modes=Object.keys(accountAccess).filter(k=>accountAccess[k]);
        if(modes.length===0) throw new Error("This account has no registered system access.");

        /*
         * The login screen is system-specific. If the user selected MS Login,
         * a VO-only account must NOT be silently opened into VO. Likewise for
         * VO Login. This is the access gate that makes the two login choices
         * genuinely separate while still using one Firebase identity.
         */
        if(window.selectedLoginSystem && accountAccess[window.selectedLoginSystem]!==true){
          // Authentication succeeded, but this Firebase account is not registered
          // for the system selected on the login screen. Treat the system choice
          // as a real access gate: show the login error and return to the login
          // screen. The user can log into their registered system and use Profile
          // -> Register for the other system to add the separate access.
          const missingSystem=window.selectedLoginSystem;
          loginError.textContent=`This account is not registered for ${missingSystem} access. Please complete ${missingSystem} registration first.`;
          try{ await signOut(auth); }catch(signoutErr){ console.warn("Sign-out after access denial failed:",signoutErr); }
          return;
        }

        loginScreen.classList.add("hidden");
        appShell.classList.add("hidden");

        // Open the system chosen on the login screen directly. The selector
        // is still available from Profile when the user wants to switch.
        if(window.selectedLoginSystem && accountAccess[window.selectedLoginSystem]===true){
          await enterAccountingMode(window.selectedLoginSystem);
        }else if(modes.length===1){
          await enterAccountingMode(modes[0]);
        }else{
          showSystemSelector(accountAccess);
        }
        loginError.textContent="";
        document.getElementById("loginPassword").value="";
        document.getElementById("loginUsername").blur();
      }catch(err){
        console.error(err);
        loginError.textContent=err.message||"Session time out. Please login again.";
        await signOut(auth);
      }
    });;
