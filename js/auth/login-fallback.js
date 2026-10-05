/* Login-page fallback wiring.
   Extracted mechanically from the original file; behavior is unchanged. */

// Independent login-page fallback wiring.  This block is deliberately outside
    // the Firebase module and outside the dashboard IIFE so the auth buttons remain
    // usable even if Firebase loads slowly or another dashboard initializer fails.
    (function(){
      function showModal(id){
        const el=document.getElementById(id);
        if(el)el.classList.remove("hidden");
      }
      function clearMsg(id){
        const el=document.getElementById(id);
        if(el){el.textContent="";el.className="auth-msg";}
      }
      function selectSystem(mode){
        mode=String(mode||"VO").toUpperCase();
        if(!["VO","MS","SHG"].includes(mode))return;
        window.selectedLoginSystem=mode;
        const labels={VO:"Login to VO → SHG",MS:"Login to MS → VO",SHG:"Login to SHG → Member"};
        ["VO","MS","SHG"].forEach(function(m){
          const id=m==="VO"?"loginVoBtn":m==="MS"?"loginMsBtn":"loginShgBtn";
          const b=document.getElementById(id);
          if(b){
            b.classList.toggle("login-system-selected",m===mode);
            b.setAttribute("aria-pressed",m===mode?"true":"false");
          }
        });
        const label=document.getElementById("selectedLoginSystem");
        if(label)label.textContent=labels[mode];
        const signup=document.getElementById("signupSystem");
        if(signup)signup.value=mode;
        const err=document.getElementById("loginError");
        if(err)err.textContent="";
      }

      window.loginPageSelectSystem=selectSystem;

      document.addEventListener("click",function(e){
        const target=e.target&&e.target.closest ? e.target.closest("button") : null;
        if(!target)return;
        const id=target.id;

        if(id==="loginVoBtn"){e.preventDefault();e.stopPropagation();selectSystem("VO");return;}
        if(id==="loginMsBtn"){e.preventDefault();e.stopPropagation();selectSystem("MS");return;}
        if(id==="loginShgBtn"){e.preventDefault();e.stopPropagation();selectSystem("SHG");return;}

        if(id==="loginBtn"){
          e.preventDefault();e.stopPropagation();
          if(typeof window.attemptLogin==="function") window.attemptLogin();
          else {
            const err=document.getElementById("loginError");
            if(err)err.textContent="Login service is still loading. Please try again in a moment.";
          }
          return;
        }

        if(id==="signUpBtn"){
          e.preventDefault();e.stopPropagation();
          clearMsg("signupMsg");
          const sys=document.getElementById("signupSystem");
          if(sys)sys.value=window.selectedLoginSystem||"VO";
          showModal("signupModal");
          return;
        }

        if(id==="forgotPasswordBtn"){
          e.preventDefault();e.stopPropagation();
          clearMsg("forgotMsg");
          showModal("forgotModal");
          return;
        }

        if(id==="signupCreateBtn"){
          e.preventDefault();e.stopPropagation();
          if(typeof window.attemptSignUp==="function") window.attemptSignUp();
          else {
            const msg=document.getElementById("signupMsg");
            if(msg){msg.textContent="Account service is still loading. Please try again in a moment.";msg.className="auth-msg error";}
          }
          return;
        }

        if(id==="sendEmailResetBtn"){
          e.preventDefault();e.stopPropagation();
          if(typeof window.sendEmailReset==="function") window.sendEmailReset();
          else {
            const msg=document.getElementById("forgotMsg");
            if(msg){msg.textContent="Password reset service is still loading. Please try again in a moment.";msg.className="auth-msg error";}
          }
          return;
        }

        const closeBtn=target.closest("[data-close-modal]");
        if(closeBtn){
          e.preventDefault();e.stopPropagation();
          const modal=document.getElementById(closeBtn.dataset.closeModal);
          if(modal)modal.classList.add("hidden");
        }
      },true);

      // Initial selected system.
      selectSystem(window.selectedLoginSystem||"VO");
    })();
