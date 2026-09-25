"use strict";

/* =========================================================
   LOGIN / PROFILE AUTH UI
   Username/email login, signup, password reset, profile and
   VO/MS access registration. Firebase transport is in firebase-auth.js.
   ========================================================= */
const loginScreen=document.getElementById("loginScreen");
    const appShell=document.getElementById("appShell");
    const loginUsername=document.getElementById("loginUsername");
    const loginPassword=document.getElementById("loginPassword");
    const loginError=document.getElementById("loginError");

    function friendlyAuthError(err){
      const code=String(err&&err.code||"");
      if(code.includes("invalid-credential")||code.includes("wrong-password")||code.includes("user-not-found"))
        return "Invalid username/email or password.";
      if(code.includes("email-already-in-use"))
        return "This email already has an account. Login and register the other system.";
      if(code.includes("invalid-email"))
        return "Enter a valid email address.";
      if(code.includes("weak-password"))
        return "Password must be at least 6 characters.";
      if(code.includes("too-many-requests"))
        return "Too many attempts. Please try again later.";
      if(code.includes("invalid-email"))
        return "Enter a valid email address.";
      if(code.includes("operation-not-allowed"))
        return "Password reset is not enabled for this account.";
      if(code.includes("permission-denied"))
        return "Firebase permission denied. Check your Firestore rules.";
      if(code.includes("unavailable"))
        return "Firebase is temporarily unavailable. Please try again.";
      if(code.includes("permission-denied")||code.includes("Missing or insufficient permissions"))
        return "Firebase Firestore permissions are blocking this operation.";
      return err&&err.message ? err.message : "Authentication failed. Please try again.";
    }

    function normalizePhone(v){
      let p=String(v||"").trim().replace(/[\s()-]/g,"");
      if(/^0\d{10}$/.test(p)) p="+91"+p.slice(1);
      if(/^\d{10}$/.test(p)) p="+91"+p;
      return p;
    }

    window.selectedLoginSystem="VO";

    function setSelectedLoginSystem(system){
      const mode=String(system||"VO").toUpperCase();
      if(!["VO","MS"].includes(mode))return;
      window.selectedLoginSystem=mode;
      const voBtn=document.getElementById("loginVoBtn");
      const msBtn=document.getElementById("loginMsBtn");
      const selectedLabel=document.getElementById("selectedLoginSystem");
      if(voBtn){voBtn.classList.toggle("login-system-selected",mode==="VO");voBtn.setAttribute("aria-pressed",mode==="VO"?"true":"false");}
      if(msBtn){msBtn.classList.toggle("login-system-selected",mode==="MS");msBtn.setAttribute("aria-pressed",mode==="MS"?"true":"false");}
      if(selectedLabel)selectedLabel.textContent=mode==="MS"?"Login to MS → VO":"Login to VO → SHG";
      const signupSystem=document.getElementById("signupSystem");
      if(signupSystem)signupSystem.value=mode;
      const loginError=document.getElementById("loginError");
      if(loginError)loginError.textContent="";
    }

    async function lookupUsername(username,system=window.selectedLoginSystem){
      const key=String(username||"").trim().toLowerCase();
      const mode=String(system||"VO").toUpperCase();
      if(!key || !["VO","MS"].includes(mode))return null;
      const scopedKey=mode+"_"+key;
      const scopedSnap=await window.firebaseCloud.getDoc(
        window.firebaseCloud.doc(window.firebaseCloud.getFirestore(),"usernames",scopedKey)
      );
      if(scopedSnap.exists())return scopedSnap.data();

      // Backward compatibility for old VO accounts whose username index was
      // stored without a system prefix.
      if(mode==="VO") {
        const legacySnap=await window.firebaseCloud.getDoc(
          window.firebaseCloud.doc(window.firebaseCloud.getFirestore(),"usernames",key)
        );
        if(legacySnap.exists())return legacySnap.data();
      }
      return null;
    }

    async function saveProfile(uid,data){
      const emailKey=String(data.email||"").trim().toLowerCase();

      const userRef=window.firebaseCloud.doc(window.firebaseCloud.getFirestore(),"users",uid);
      const existingSnap=await window.firebaseCloud.getDoc(userRef);
      const existingData=existingSnap.exists()?existingSnap.data()||{}:{};
      const existingAccess=existingData.access||{};
      const access={
        VO:existingAccess.VO===true || data.system==="VO",
        MS:existingAccess.MS===true || data.system==="MS"
      };

      await window.firebaseCloud.setDoc(
        userRef,
        {
          profile:{
            email:data.email,
            mobile:data.mobile,
            username:data.username
          },
          access,
          updatedAt:new Date().toISOString()
        },
        {merge:true}
      );

      // Public lookup record contains no password. It allows Forgot Password
      // to resolve a registered email without relying on Firebase's
      // anti-enumeration sign-in-method API.
      await window.firebaseCloud.setDoc(
        window.firebaseCloud.doc(window.firebaseCloud.getFirestore(),"accountLookup","email_"+emailKey),
        {uid,email:data.email,username:data.username},
        {merge:true}
      );
    }

    async function lookupEmail(email){
      const key=String(email||"").trim().toLowerCase();
      if(!key)return null;
      const snap=await window.firebaseCloud.getDoc(
        window.firebaseCloud.doc(window.firebaseCloud.getFirestore(),"accountLookup","email_"+key)
      );
      return snap.exists()?snap.data():null;
    }

    async function reserveUsername(uid,email,username,system){
      const key=String(username||"").trim().toLowerCase();
      const mode=String(system||"VO").toUpperCase();
      if(!key)throw new Error("Username is required.");
      if(!["VO","MS"].includes(mode))throw new Error("Invalid registration system.");
      const db=window.firebaseCloud.getFirestore();
      const ref=window.firebaseCloud.doc(db,"usernames",mode+"_"+key);

      // Username uniqueness is scoped to the registration system. The same
      // username is therefore allowed for VO and MS.
      await window.firebaseCloud.runTransaction(db,async(transaction)=>{
        const snap=await transaction.get(ref);
        if(snap.exists()){
          const owner=snap.data()||{};
          if(String(owner.uid||"")===String(uid||""))return;
          throw new Error("USERNAME_ALREADY_EXISTS");
        }
        transaction.set(ref,{uid,email,system:mode},{merge:false});
      });
    }



    async function attemptLogin(){
      const identifier=loginUsername.value.trim();
      const password=loginPassword.value;
      const system=window.selectedLoginSystem;

      if(!identifier||!password){
        loginError.textContent="Enter your username/email and password.";
        return;
      }

      loginError.textContent="Signing in...";

      try{
        let email=identifier;

        if(!identifier.includes("@")){
          const rec=await lookupUsername(identifier,system);
          if(!rec||!rec.email){
            loginError.textContent="Invalid username/email or password.";
            return;
          }
          email=rec.email;
        }

        await window.firebaseCloud.signIn(email,password);
        // onAuthStateChanged handles both cases:
        //   1. selected system is already registered -> open it
        //   2. selected system is not registered -> show a system-specific
        //      access error and return to the login screen.
      }catch(err){
        console.error(err);
        loginError.textContent=friendlyAuthError(err);
      }
    }

    function openModal(id){
      const el=document.getElementById(id);
      if(el)el.classList.remove("hidden");
    }

    function closeModal(id){
      const el=document.getElementById(id);
      if(el)el.classList.add("hidden");
    }

    function validateAccountForm(){
      const email=document.getElementById("signupEmail").value.trim();
      const mobile=normalizePhone(document.getElementById("signupMobile").value);
      const username=document.getElementById("signupUsername").value.trim();
      const pw=document.getElementById("signupPassword").value;
      const cp=document.getElementById("signupConfirm").value;
      const system=(document.getElementById("signupSystem")?.value||"VO").toUpperCase();

      if(!email||!mobile||!username||!pw||!cp)
        throw new Error("Fill all required fields.");
      if(!/^\S+@\S+\.\S+$/.test(email))
        throw new Error("Enter a valid email address.");
      if(!/^\+\d{8,15}$/.test(mobile))
        throw new Error("Enter a valid mobile number.");
      if(!/^[A-Za-z0-9._-]{3,30}$/.test(username))
        throw new Error("Username must be 3-30 characters and use letters, numbers, dot, underscore or hyphen.");
      if(pw.length<6)
        throw new Error("Password must be at least 6 characters.");
      if(pw!==cp)
        throw new Error("Passwords do not match.");

      if(!["VO","MS"].includes(system)) throw new Error("Select a valid registration system.");
      return {email,mobile,username,pw,system};
    }

    async function openProfile(){
      const modal=document.getElementById("profileModal");
      const summary=document.getElementById("profileSummary");
      const mobileInput=document.getElementById("profileMobileInput");
      const msg=document.getElementById("profileMsg");

      if(msg){
        msg.textContent="";
        msg.className="auth-msg";
      }

      const user=window.firebaseCloud && window.firebaseCloud.currentUser;
      if(!user){
        if(msg){
          msg.textContent="Please login again to open Profile.";
          msg.className="auth-msg error";
        }
        if(modal)modal.classList.remove("hidden");
        return;
      }

      try{
        const snap=await window.firebaseCloud.getDoc(
          window.firebaseCloud.doc(window.firebaseCloud.getFirestore(),"users",user.uid)
        );
        const data=snap.exists()?snap.data():{};
        const profile=data.profile||{};
        const access=data.access||{VO:true,MS:false};

        if(summary){
          summary.innerHTML=
            "<div><b>Email:</b> "+String(profile.email||user.email||"")+"</div>"+
            "<div><b>Username:</b> "+String(profile.username||"")+"</div>";
        }
        if(mobileInput)mobileInput.value=profile.mobile||"";
        const accessSummary=document.getElementById("profileAccessSummary");
        if(accessSummary)accessSummary.innerHTML=
          `<div><b>VO Access:</b> ${access.VO===true?"Registered":"Not registered"}</div>`+
          `<div><b>MS Access:</b> ${access.MS===true?"Registered":"Not registered"}</div>`;
        const rv=document.getElementById("registerVOAccessBtn"), rm=document.getElementById("registerMSAccessBtn");
        if(rv){rv.disabled=access.VO===true;rv.textContent=access.VO===true?"VO Registered":"Register for VO";}
        if(rm){rm.disabled=access.MS===true;rm.textContent=access.MS===true?"MS Registered":"Register for MS";}
        if(modal)modal.classList.remove("hidden");
      }catch(err){
        console.error(err);
        if(summary)summary.textContent="";
        if(msg){
          msg.textContent=friendlyAuthError(err);
          msg.className="auth-msg error";
        }
        if(modal)modal.classList.remove("hidden");
      }
    }

    async function saveProfileMobile(){
      const user=window.firebaseCloud && window.firebaseCloud.currentUser;
      const input=document.getElementById("profileMobileInput");
      const msg=document.getElementById("profileMsg");
      if(!user){
        if(msg)msg.textContent="Please login again.";
        return;
      }

      const mobile=normalizePhone(input ? input.value : "");
      if(!/^\+\d{8,15}$/.test(mobile)){
        if(msg){
          msg.textContent="Enter a valid mobile number.";
          msg.className="auth-msg error";
        }
        return;
      }

      try{
        if(msg){
          msg.textContent="Saving mobile number...";
          msg.className="auth-msg";
        }

        const snap=await window.firebaseCloud.getDoc(
          window.firebaseCloud.doc(window.firebaseCloud.getFirestore(),"users",user.uid)
        );
        const existing=snap.exists()?snap.data():{};
        const profile=existing.profile||{};

        await window.firebaseCloud.setDoc(
          window.firebaseCloud.doc(window.firebaseCloud.getFirestore(),"users",user.uid),
          {
            profile:{
              email:profile.email||user.email||"",
              username:profile.username||"",
              mobile:mobile
            },
            updatedAt:new Date().toISOString()
          },
          {merge:true}
        );

        if(msg){
          msg.textContent="Mobile number saved.";
          msg.className="auth-msg ok";
        }
      }catch(err){
        sessionStorage.removeItem("pendingRegistrationSystem");
        console.error(err);
        if(msg){
          msg.textContent=friendlyAuthError(err);
          msg.className="auth-msg error";
        }
      }
    }

    async function changeProfilePassword(){
      const user=window.firebaseCloud && window.firebaseCloud.currentUser;
      const pw=document.getElementById("profileNewPassword");
      const cp=document.getElementById("profileConfirmPassword");
      const msg=document.getElementById("profileMsg");

      if(!user){
        if(msg)msg.textContent="Please login again.";
        return;
      }

      const newPw=pw?pw.value:"";
      const confirmPw=cp?cp.value:"";

      if(newPw.length<6){
        if(msg){
          msg.textContent="Password must be at least 6 characters.";
          msg.className="auth-msg error";
        }
        return;
      }
      if(newPw!==confirmPw){
        if(msg){
          msg.textContent="Passwords do not match.";
          msg.className="auth-msg error";
        }
        return;
      }

      try{
        if(msg){
          msg.textContent="Changing password...";
          msg.className="auth-msg";
        }
        await window.firebaseCloud.updatePassword(newPw);
        if(pw)pw.value="";
        if(cp)cp.value="";
        if(msg){
          msg.textContent="Password changed successfully.";
          msg.className="auth-msg ok";
        }
      }catch(err){
        console.error(err);
        if(msg){
          msg.textContent=friendlyAuthError(err);
          msg.className="auth-msg error";
        }
      }
    }

    async function sendEmailReset(){
      const input=document.getElementById("forgotIdentifier");
      const msg=document.getElementById("forgotMsg");
      const identifier=input ? input.value.trim() : "";

      if(!identifier){
        msg.textContent="Enter your registered email or username.";
        msg.className="auth-msg error";
        return;
      }

      msg.textContent="Checking account...";
      msg.className="auth-msg";

      try{
        let email="";

        if(identifier.includes("@")){
          const emailKey=identifier.toLowerCase();

          // Our accountLookup is the application's registration directory.
          // Never call Firebase password-reset until this confirms that the
          // email was registered by this application.
          const rec=await lookupEmail(emailKey);

          if(!rec || !rec.email){
            msg.textContent="No account was found with that email address.";
            msg.className="auth-msg error";
            return;
          }

          email=rec.email;
        }else{
          const rec=await lookupUsername(identifier);

          if(!rec || !rec.email){
            msg.textContent="No account was found with that username.";
            msg.className="auth-msg error";
            return;
          }

          email=rec.email;
        }

        // Only a confirmed registered account reaches this line.
        await window.firebaseCloud.sendPasswordResetEmail(email);

        msg.textContent="Password reset email sent. Please check your email inbox (and Spam/Junk).";
        msg.className="auth-msg ok";
      }catch(err){
        console.error("Forgot password failed:",err);

        if(String(err&&err.code||"").includes("permission-denied")){
          msg.textContent="Unable to verify the account. Please check your Firestore rules.";
        }else if(String(err&&err.code||"").includes("invalid-email")){
          msg.textContent="Enter a valid email address.";
        }else{
          msg.textContent="No account was found with that email address.";
        }
        msg.className="auth-msg error";
      }
    }

    async function attemptSignUp(){
      const btn=document.getElementById("signupCreateBtn");
      const msg=document.getElementById("signupMsg");
      if(btn)btn.disabled=true;

      try{
        const data=validateAccountForm();
        const usernameKey=String(data.username||"").trim().toLowerCase();

        if(msg){
          msg.textContent=`Checking ${data.system} registration...`;
          msg.className="auth-msg";
        }

        /*
         * Do not reject an existing username before authenticating the user.
         * A previous interrupted registration may already have created the
         * system-scoped username document for THIS SAME Firebase UID.
         * reserveUsername() safely allows that owner to reuse the reservation.
         * It rejects the username only when another UID owns it.
         */
        if(msg){
          msg.textContent="Checking registration...";
          msg.className="auth-msg";
        }

        /*
         * Firebase Auth permits only one account per email. Therefore an
         * existing VO user registering for MS (or vice versa) must reuse the
         * same Firebase account instead of attempting to create another one.
         * The password entered here authenticates that existing account.
         */
        let user=null;
        let existingEmailAccount=false;

        try{
          const cred=await window.firebaseCloud.signUp(data.email,data.pw);
          user=cred&&cred.user ? cred.user : window.firebaseCloud.currentUser;
        }catch(authErr){
          if(String(authErr&&authErr.code||"")==="auth/email-already-in-use"){
            existingEmailAccount=true;
            if(msg){
              msg.textContent="Existing account found. Verifying password and registering the additional system...";
              msg.className="auth-msg";
            }
            user=await window.firebaseCloud.signIn(data.email,data.pw);
            user=user&&user.user ? user.user : user;
          }else{
            throw authErr;
          }
        }

        if(!user)throw new Error("Account could not be loaded.");

        const access=await window.firebaseCloud.getAccountAccess();
        if(access[data.system]===true){
          throw new Error(`This account is already registered for ${data.system}.`);
        }

        try{
          await reserveUsername(user.uid,data.email,usernameKey,data.system);
        }catch(e){
          if(String(e.message||"")==="USERNAME_ALREADY_EXISTS")
            throw new Error(`Username already exists for ${data.system} under another account. Please choose another username for this system.`);
          throw e;
        }

        await saveProfile(user.uid,data);
        sessionStorage.removeItem("pendingRegistrationSystem");

        if(msg){
          msg.textContent=`${data.system} registration completed successfully.`;
          msg.className="auth-msg ok";
        }

        // Close signup and let the normal auth-state flow open the correct
        // system (or the system selector when both are registered).
        closeModal("signupModal");
        ["signupEmail","signupMobile","signupUsername","signupPassword","signupConfirm"].forEach(id=>{
          const el=document.getElementById(id);
          if(el)el.value="";
        });
        const sys=document.getElementById("signupSystem");
        if(sys)sys.value=window.selectedLoginSystem;

        // If this was an existing account, it is already signed in. If this
        // was a brand-new account, Firebase is also signed in automatically.
        // onAuthStateChanged will handle the dashboard transition.

      }catch(err){
        sessionStorage.removeItem("pendingRegistrationSystem");
        console.error(err);
        if(msg){
          msg.textContent=err.message||friendlyAuthError(err);
          msg.className="auth-msg error";
        }
      }finally{
        if(btn)btn.disabled=false;
      }
    }

    document.getElementById("loginVoBtn").onclick=()=>setSelectedLoginSystem("VO");
    document.getElementById("loginMsBtn").onclick=()=>setSelectedLoginSystem("MS");
    // Initial state: VO is selected and therefore BLUE.
    setSelectedLoginSystem(window.selectedLoginSystem);

    document.getElementById("loginBtn").onclick=attemptLogin;
    document.getElementById("signUpBtn").onclick=()=>{
      const msg=document.getElementById("signupMsg");
      if(msg){msg.textContent="";msg.className="auth-msg";}
      const sys=document.getElementById("signupSystem"); if(sys)sys.value=window.selectedLoginSystem;
      openModal("signupModal");
    };
    document.getElementById("signupCreateBtn").onclick=attemptSignUp;
    document.getElementById("forgotPasswordBtn").onclick=()=>{
      const msg=document.getElementById("forgotMsg");
      if(msg){msg.textContent="";msg.className="auth-msg";}
      openModal("forgotModal");
    };
    document.getElementById("sendEmailResetBtn").onclick=sendEmailReset;
    // Modal controls: use delegated handling so every Close/Cancel button works,
    // including buttons added dynamically.
    document.addEventListener("click",function(e){
      const closeBtn=e.target.closest("[data-close-modal]");
      if(closeBtn){
        e.preventDefault();
        e.stopPropagation();
        closeModal(closeBtn.dataset.closeModal);
        return;
      }

      const toggle=e.target.closest(".toggle-pass");
      if(toggle){
        const input=document.getElementById(toggle.dataset.target);
        if(input){
          input.type=input.type==="password"?"text":"password";
          toggle.textContent=input.type==="password"?"Show":"Hide";
        }
      }
    });

    document.querySelectorAll(".auth-modal").forEach(function(modal){
      modal.addEventListener("click",function(e){
        if(e.target===modal)closeModal(modal.id);
      });
    });

    async function registerOtherSystem(mode){
      const msg=document.getElementById("profileMsg");
      try{
        const user=window.firebaseCloud && window.firebaseCloud.currentUser;
        if(!user)throw new Error("Please login again.");

        const snap=await window.firebaseCloud.getDoc(
          window.firebaseCloud.doc(window.firebaseCloud.getFirestore(),"users",user.uid)
        );
        const data=snap.exists()?(snap.data()||{}):{};
        const profile=data.profile||{};
        const username=String(profile.username||"").trim();
        const email=String(profile.email||user.email||"").trim();
        if(!username)throw new Error("Username is required before registering another system.");

        if(msg){msg.textContent=`Registering this account for ${mode}...`;msg.className="auth-msg";}

        // Reserve the same username independently for the second system.
        // The same username is valid in VO and MS because reservations are
        // stored as VO_username and MS_username.
        await reserveUsername(user.uid,email,username,mode);
        await window.firebaseCloud.registerSystemAccess(mode);

        if(msg){msg.textContent=`${mode} registration completed. You can now access ${mode}.`;msg.className="auth-msg ok";}
        await openProfile();
        const access=window.firebaseCloud.accountAccess||{};
        const modes=["VO","MS"].filter(x=>access[x]);
        if(modes.length>1){
          const modal=document.getElementById("systemSelectModal");
          if(modal)modal.classList.remove("hidden");
        }else{
          await window.firebaseCloud.enterAccountingMode(mode);
        }
      }catch(err){
        if(msg){msg.textContent=err.message||"Registration failed.";msg.className="auth-msg error";}
      }
    }

    const profileBtnEl=document.getElementById("profileBtn");
    if(profileBtnEl)profileBtnEl.onclick=openProfile;
    document.getElementById("registerVOAccessBtn")?.addEventListener("click",()=>registerOtherSystem("VO"));
    document.getElementById("registerMSAccessBtn")?.addEventListener("click",()=>registerOtherSystem("MS"));

    const saveProfileMobileBtn=document.getElementById("saveProfileMobileBtn");
    if(saveProfileMobileBtn)saveProfileMobileBtn.onclick=saveProfileMobile;

    const changePasswordBtn=document.getElementById("changePasswordBtn");
    if(changePasswordBtn)changePasswordBtn.onclick=changeProfilePassword;
