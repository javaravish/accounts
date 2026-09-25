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
      setDoc,
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
    let accountAccess = {VO:false,MS:false};
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
      const snap = await getDoc(userDocRef());
      if(!snap.exists()) return null;
      const data = snap.data()||{};
      const field = mode === "MS" ? "msData" : "voData";
      if(data[field] && Array.isArray(data[field].vos)) return data[field];
      // Backward compatibility: existing VO users have the old `vos` field.
      if(mode === "VO" && Array.isArray(data.vos)) return {vos:data.vos};
      return null;
    }

    async function saveCloudDb(db,mode){
      if(!currentUser) return;
      const field = mode === "MS" ? "msData" : "voData";
      const payload={
        [field]: {vos:Array.isArray(db.vos)?db.vos:[]},
        updatedAt: new Date().toISOString(),
        ownerUid: currentUser.uid
      };
      // Keep legacy VO data synchronized for existing deployments.
      if(mode === "VO") payload.vos=Array.isArray(db.vos)?db.vos:[];
      await setDoc(userDocRef(),payload,{merge:true});
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
          if(el) el.textContent="Local saved • Cloud save failed";
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
      let access=data.access||{};
      const pending=String(sessionStorage.getItem("pendingRegistrationSystem")||"").toUpperCase();
      // New accounts may be created directly for either system.
      if(access.VO!==true && access.MS!==true){
        access=(pending==="MS")?{VO:false,MS:true}:{VO:true,MS:false};
        await setDoc(doc(firestore,"users",user.uid),{access,updatedAt:new Date().toISOString()},{merge:true});
      }
      if(pending==="VO" || pending==="MS") sessionStorage.removeItem("pendingRegistrationSystem");
      return {VO:access.VO===true,MS:access.MS===true};
    }

    async function registerSystemAccess(mode){
      if(!currentUser || !["VO","MS"].includes(mode)) throw new Error("Invalid system.");
      const ref=doc(firestore,"users",currentUser.uid);
      const snap=await getDoc(ref);
      const data=snap.exists()?(snap.data()||{}):{};
      const access={...(data.access||{})};
      access[mode]=true;
      await setDoc(ref,{access,updatedAt:new Date().toISOString(),profile:data.profile||{email:currentUser.email||""}},{merge:true});
      accountAccess=access;
      return access;
    }

    async function enterAccountingMode(mode){
      if(!accountAccess[mode]) throw new Error("This account is not registered for "+mode+".");
      activeMode=mode;
      cloudLoaded=false;
      const cloud=await loadCloudDb(mode);
      const localKey=mode === "MS" ? "ms_shg_accounting_v18" : "vo_shg_accounting_v18";
      const localRaw=localStorage.getItem(localKey);
      const localDb=localRaw ? (()=>{try{return JSON.parse(localRaw)}catch(e){return {vos:[]}}})() : {vos:[]};
      let initial=cloud||{vos:[]};
      if(!cloud && localDb && Array.isArray(localDb.vos) && localDb.vos.length){
        const useLocal=confirm("No cloud data was found for this "+mode+" system.\n\nExisting data was found on this device.\n\nPress OK to upload it, or Cancel to start empty.");
        if(useLocal) initial=localDb;
      }
      if(!cloud) await saveCloudDb(initial,mode);
      window.dispatchEvent(new CustomEvent("firebase-cloud-ready",{detail:{db:initial,hasCloud:!!cloud,mode}}));
      cloudLoaded=true;
      const loginScreen=document.getElementById("loginScreen");
      const appShell=document.getElementById("appShell");
      if(loginScreen)loginScreen.classList.add("hidden");
      if(appShell)appShell.classList.remove("hidden");
      const modal=document.getElementById("systemSelectModal");
      if(modal)modal.classList.add("hidden");
      return true;
    }

    function showSystemSelector(access){
      const modal=document.getElementById("systemSelectModal");
      const box=document.getElementById("systemSelectActions");
      if(!modal||!box)return;
      box.innerHTML="";
      ["VO","MS"].forEach(mode=>{
        if(!access[mode])return;
        const b=document.createElement("button");
        b.type="button"; b.className="primary";
        b.textContent=mode === "VO" ? "Open VO → SHG" : "Open MS → VO";
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
      setDoc,
      runTransaction,

      loadCloudDb,
      saveCloudDb,
      queueCloudSave,
      saveNowBeforeLogout,
      setCloudLoaded(v){cloudLoaded=!!v;}
    };

    onAuthStateChanged(auth, async(user)=>{
      currentUser=user||null;
      if(!user){
        clearInactivityTimer();
        cloudLoaded=false;
        accountAccess={VO:false,MS:false};
        const loginScreen=document.getElementById("loginScreen");
        const appShell=document.getElementById("appShell");
        if(loginScreen)loginScreen.classList.remove("hidden");
        if(appShell)appShell.classList.add("hidden");
        const selector=document.getElementById("systemSelectModal");
        if(selector)selector.classList.add("hidden");
        return;
      }

      startInactivityTimer();
      const loginScreen=document.getElementById("loginScreen");
      const appShell=document.getElementById("appShell");
      const loginError=document.getElementById("loginError");

      try{
        accountAccess=await readAccountAccess(user);

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
