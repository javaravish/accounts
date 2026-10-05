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
          // Save all current accounting data before ending the session.
          await saveAppDataBeforeAuthLogout();
          await signOut(auth);
        }catch(err){
          console.error("Automatic inactivity logout failed:",err);
        }finally{
          isLoggingOutAutomatically=false;
          clearInactivityTimer();
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
          // Save all current accounting data before ending the session.
          await saveAppDataBeforeAuthLogout();
          await signOut(auth);
        }catch(err){ console.error(err); }
        finally{ isLoggingOutAutomatically=false; clearInactivityTimer(); }
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

    function userDocRef(){
      if(!currentUser) return null;
      return doc(firestore, "users", currentUser.uid);
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

    async function loadCloudDb(mode){
      if(!currentUser) return null;

      /*
       * New storage layout: each VO/MS/SHG parent record is stored in its
       * own Firestore document under users/{uid}/modeData/{mode}/records.
       * This avoids Firestore's 1 MiB document limit when an account contains
       * many SHGs and many months.
       */
      try{
        const recordsRef=collection(firestore,"users",currentUser.uid,"modeData",mode,"records");
        const recordsSnap=await getDocs(recordsRef);
        if(!recordsSnap.empty){
          const vos=[];
          recordsSnap.forEach(s=>{
            const d=s.data()||{};
            if(d.data)vos.push(d.data);
          });
          vos.sort((a,b)=>String(a.id||"").localeCompare(String(b.id||"")));
          if(vos.length)return {vos};
        }
      }catch(err){
        console.warn("Chunked cloud load unavailable; trying legacy storage:",err);
      }

      /* Backward compatibility with the existing single-document layout. */
      const snap = await getDoc(userDocRef());
      if(!snap.exists()) return null;
      const data = snap.data()||{};
      const field = mode === "MS" ? "msData" : (mode === "SHG" ? "shgData" : "voData");
      if(data[field] && Array.isArray(data[field].vos)) return data[field];
      if(mode === "VO" && Array.isArray(data.vos)) return {vos:data.vos};
      return null;
    }


    function isFirestoreDocumentTooLarge(err){
      const code=String(err?.code||"").toLowerCase();
      const message=String(err?.message||err||"");
      return code.includes("resource-exhausted") || /1\s*MiB|1048576|maximum.*size|document.*too large|exceeds.*maximum/i.test(message);
    }

    async function saveCloudDbChunked(db,mode){
      if(!currentUser) return;
      const recordsRef=collection(firestore,"users",currentUser.uid,"modeData",mode,"records");
      const vos=Array.isArray(db?.vos)?db.vos:[];
      const activeIds=new Set();

      for(let i=0;i<vos.length;i++){
        const record=vos[i];
        const id=String(record?.id||`record_${i}`).replace(/\//g,"_");
        activeIds.add(id);
        await setDoc(doc(recordsRef,id),{data:record,ownerUid:currentUser.uid,mode,updatedAt:new Date().toISOString()},{merge:true});
      }

      /* Remove old chunk records when a parent/member was deleted. */
      const existing=await getDocs(recordsRef);
      const deletes=[];
      existing.forEach(s=>{if(!activeIds.has(s.id))deletes.push(deleteDoc(s.ref));});
      if(deletes.length)await Promise.all(deletes);
    }

    function describeCloudSaveError(err){
      const code=String(err?.code||'').replace(/^firebase\./,'');
      const message=String(err?.message||err||'Unknown Firebase error');
      if(code.includes('permission-denied')){
        return `Firebase rejected the cloud save (permission-denied). Your internet is working, but the Firestore security rules are not allowing this account to write this data.\n\nDetails: ${message}`;
      }
      if(code.includes('resource-exhausted') || /1 MiB|1048576|maximum.*size|document.*too large/i.test(message)){
        return `Firebase rejected the cloud save because the Firestore document is too large. The data needs to be split into smaller cloud records instead of one large document.\n\nDetails: ${message}`;
      }
      if(code.includes('unauthenticated')){
        return `The Firebase login session is no longer authenticated. Please sign out, sign in again, and save again.\n\nDetails: ${message}`;
      }
      if(code.includes('unavailable') || code.includes('deadline-exceeded') || /network|offline|failed to fetch/i.test(message)){
        return `Firebase could not reach the cloud service. Your general internet connection can still be working; this can be a Firebase/network request problem. Please wait a moment and try Save All again.\n\nDetails: ${message}`;
      }
      return `Cloud synchronization failed even though the data was saved locally.\n\nFirebase error${code ? ` (${code})` : ''}: ${message}`;
    }

    async function saveCloudDb(db,mode){
      if(!currentUser) return;
      const field = mode === "MS" ? "msData" : (mode === "SHG" ? "shgData" : "voData");
      const payload={
        [field]: {vos:Array.isArray(db.vos)?db.vos:[]},
        updatedAt: new Date().toISOString(),
        ownerUid: currentUser.uid
      };
      if(mode === "VO") payload.vos=Array.isArray(db.vos)?db.vos:[];

      try{
        /* Keep the existing layout for small accounts. */
        await setDoc(userDocRef(),payload,{merge:true});
        return;
      }catch(err){
        /* Large accounts cannot fit in one Firestore document.  Automatically
         * switch to one-document-per-parent storage instead of reporting a
         * misleading internet failure. */
        if(!isFirestoreDocumentTooLarge(err)) throw err;
        console.warn("Legacy cloud document is too large; switching to chunked storage.",err);
        await saveCloudDbChunked(db,mode);
      }
    }

    function queueCloudSave(db){
      if(!currentUser || !cloudLoaded) return;
      clearTimeout(saveTimer);
      saveTimer=setTimeout(async()=>{
        try{
          await saveCloudDb(db,activeMode);
          const el=document.getElementById("saveStatus");
          if(el) el.textContent="Data Saved";
        }catch(err){
          console.error("Firebase auto-save failed:",err);
          const el=document.getElementById("saveStatus");
          const code=String(err?.code||"").replace(/^firebase\./,"");
          if(el) el.textContent=`Wait Data Saving...${code?` (${code})`:""}`;
        }
      },700);
    }

    // Flush the pending auto-save immediately before logout.
    async function saveNowBeforeLogout(db){
      clearTimeout(saveTimer);
      if(!currentUser || !cloudLoaded) return false;
      await saveCloudDb(db,activeMode);
      const el=document.getElementById("saveStatus");
      if(el) el.textContent="Data Saved before logout";
      return true;
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
      if(!cloud) await saveCloudDb(initial,mode);
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
      logout: ()=>signOut(auth),
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
      setCloudLoaded(v){cloudLoaded=!!v;}
    };

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
        try{
          const profileSnap=await window.firebaseCloud.getDoc(
            window.firebaseCloud.doc(window.firebaseCloud.getFirestore(),"users",user.uid)
          );
          const profileData=profileSnap.exists()?(profileSnap.data()||{}):{};
          const profile=profileData.profile||{};
          if(loggedInAs)loggedInAs.textContent="Logged in As : "+String(profile.name||user.displayName||user.email||"");
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
