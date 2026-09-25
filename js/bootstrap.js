"use strict";

/* =========================================================
   UI BOOTSTRAP / EVENT WIRING
   Binds buttons and shared browser events after the responsibility
   modules have been loaded.
   ========================================================= */
document.getElementById("homeBtn").onclick=goHome;

    document.getElementById("logoutBtn").onclick=async()=>{
      const btn=document.getElementById("logoutBtn");
      if(btn) btn.disabled=true;
      try{
        // IMPORTANT: save all current data before ending the Firebase session.
        await window.saveAppDataBeforeLogout();
        await window.firebaseCloud.logout();
      }catch(err){
        console.error(err);
        alert("Logout failed. Please try again.");
      }finally{
        if(btn) btn.disabled=false;
      }
    };
    loginUsername.onkeydown=e=>{if(e.key==="Enter"){e.preventDefault();loginPassword.focus();}};
    loginPassword.onkeydown=e=>{if(e.key==="Enter"){e.preventDefault();attemptLogin();}};
    setTimeout(()=>loginUsername.focus(),50);

    const openNewVoForm=()=>{
      if(!confirmSwitch("creating a new VO"))return;
      document.getElementById("newVoForm").classList.remove("hidden");
      document.getElementById("newVoName").focus();
    };

    // Both Create New VO buttons use the same handler.
    // The Home-page button was previously missing its click binding.
    const homeNewVoBtn=document.getElementById("homeNewVoBtn");
    if(homeNewVoBtn)homeNewVoBtn.onclick=openNewVoForm;

    document.getElementById("cancelVoBtn").onclick=()=>document.getElementById("newVoForm").classList.add("hidden");
    document.getElementById("createVoBtn").onclick=createVO;
    document.getElementById("newVoName").onkeydown=e=>{if(e.key==="Enter"){e.preventDefault();createVO();}};
    document.getElementById("voSelect").onchange=e=>{
      const id=e.target.value;if(!id||id===selectedVOId)return;
      selectedVOId=id;monthIndex=0;refresh();
      document.getElementById("voDetailsSection").classList.remove("hidden");
      const homeNewVoBtn=document.getElementById("homeNewVoBtn");
      if(homeNewVoBtn)homeNewVoBtn.style.removeProperty("display");
      document.getElementById("dataManagementSection").classList.add("hidden");
      markClean();
    };
    document.getElementById("saveVoBtn").onclick=saveVO;
    document.getElementById("addShgBtn").onclick=addSHG;
    document.getElementById("shgNameInput").onkeydown=e=>{if(e.key==="Enter"){e.preventDefault();addSHG();}};
    document.getElementById("saveAllBtn").onclick=saveAll;
    /*
     * PDF button handlers.
     *
     * IMPORTANT:
     * monthlyPDF(), cumulativeDcbPDF() and ledgerPDF() accept an internal
     * `asPart` argument for the "All 3 PDFs" combined report.
     * Assigning the functions directly to onclick passes the browser Event
     * object as that first argument, making `asPart` truthy and preventing
     * the individual PDF from calling printReport().
     *
     * Use wrapper functions so individual buttons ALWAYS call with false.
     */
    document.getElementById("monthlyPdfBtn").onclick=()=>monthlyPDF(false);
    document.getElementById("cumulativeDcbPdfBtn").onclick=()=>cumulativeDcbPDF(false);
    document.getElementById("ledgerPdfBtn").onclick=()=>ledgerPDF(false);
    document.getElementById("allPdfsBtn").onclick=()=>allPdfsPDF();
    document.getElementById("backupBtn").onclick=exportBackup;
    document.getElementById("importBtn").onclick=()=>{
      document.getElementById("fileInput").dataset.importMode="replace";
      document.getElementById("fileInput").click();
    };
    document.getElementById("importAllBtn").onclick=()=>{
      document.getElementById("fileInput").dataset.importMode="merge";
      document.getElementById("fileInput").click();
    };
    document.getElementById("fileInput").onchange=e=>{
      const file=e.target.files[0];
      const mode=e.target.dataset.importMode||"replace";
      if(file){
        if(mode==="merge")importAllBackup(file);
        else importBackup(file);
      }
      e.target.value="";
      e.target.dataset.importMode="";
    };
    document.getElementById("resetBtn").onclick=resetAll;
    window.addEventListener("resize",function(){
      if(document.querySelector("#entryBody input.name"))fitShgNameColumn();
    });

    document.addEventListener("input",function(e){
      if(e.target.matches && e.target.matches("#entryBody input.name")){
        fitShgNameColumn();
      }
      if(e.target.matches("input,textarea") && !["newVoName","loginUsername","loginPassword","signupEmail","signupMobile","signupUsername","signupPassword","signupConfirm"].includes(e.target.id))markDirty();
      const m=e.target.id&&e.target.id.match(/^(prevP|prevI|demandP)-(\d+)$/);
      if(m && typeof window.recalc==="function") window.recalc(Number(m[2]));
    });


    /* Universal button animation engine: covers static and dynamically-created buttons. */
    document.addEventListener("click",function(e){
      const button=e.target.closest("button");
      if(!button || button.disabled)return;

      const rect=button.getBoundingClientRect();
      const ripple=document.createElement("span");
      ripple.className="button-ripple";
      ripple.style.left=(e.clientX-rect.left)+"px";
      ripple.style.top=(e.clientY-rect.top)+"px";
      button.appendChild(ripple);
      ripple.addEventListener("animationend",()=>ripple.remove(),{once:true});

      /* A visible click bounce for every action without changing its behavior. */
      button.classList.remove("button-success-flash");
      void button.offsetWidth;
      button.classList.add("button-success-flash");
      setTimeout(()=>button.classList.remove("button-success-flash"),600);
    },true);

    /* Initial dashboard refresh is performed after successful login. */
