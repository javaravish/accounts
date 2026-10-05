/* Main dashboard/application controller.
   Extracted mechanically from the original file; behavior is unchanged.
   PDF/report functions remain in this controller for this first safe refactor
   because they share its private state and helper functions. */

(function(){
    "use strict";
    let currentMode = "VO";
    const FINANCIAL_YEARS=["2024-25","2025-26","2026-27","2027-28","2028-29","2029-30","2030-31"];
    function buildMonths(financialYear){
      const match=String(financialYear||"2026-27").match(/^(\d{4})-(\d{2})$/);
      const startYear=match?Number(match[1]):2026;
      const nextYear=String((startYear+1)%100).padStart(2,"0");
      const months=[
        ["Apr-"+String(startYear).slice(-2),"April-"+startYear],
        ["May-"+String(startYear).slice(-2),"May-"+startYear],
        ["Jun-"+String(startYear).slice(-2),"June-"+startYear],
        ["Jul-"+String(startYear).slice(-2),"July-"+startYear],
        ["Aug-"+String(startYear).slice(-2),"August-"+startYear],
        ["Sep-"+String(startYear).slice(-2),"September-"+startYear],
        ["Oct-"+String(startYear).slice(-2),"October-"+startYear],
        ["Nov-"+String(startYear).slice(-2),"November-"+startYear],
        ["Dec-"+String(startYear).slice(-2),"December-"+startYear],
        ["Jan-"+nextYear,"January-"+(startYear+1)],
        ["Feb-"+nextYear,"February-"+(startYear+1)],
        ["Mar-"+nextYear,"March-"+(startYear+1)]
      ];
      return months;
    }
    let currentFinancialYear="";
    let MONTHS=buildMonths(currentFinancialYear);
    let db={vos:[]}, selectedVOId=null, monthIndex=0, dirty=false;
    let selectedLoanType="cif", selectedMemberId="ALL";

    /*
     * SINGLE SOURCE OF TRUTH FOR VO/MS DIFFERENCES
     * ----------------------------------------------
     * Keep all shared UI, tables, PDF renderers, fonts, borders, spacing and
     * alignment in one implementation. Only genuine business differences live
     * in this configuration.
     */
    const ACCOUNTING_CONFIG=Object.freeze({
      VO:Object.freeze({
        parent:"VO",
        child:"SHG",
        parentPlural:"VO",
        childPlural:"SHGs",
        storageKey:"vo_shg_accounting_v18",
        detailsColumns:5,
        showVillage:true,
        showVoName:false,
        voNameRequired:false,
        villageRequired:true,
        districtRequired:false,
        firstLocationField:"village",
        loanTypes:[
          {key:"cif",label:"1. VO CIF"},
          {key:"internalLoan",label:"2. Internal"}
        ],
        backupFilename:"vo-shg-backup.json",
        pdf:{
          headerFields:[
            {label:"గ్రామం",field:"village"},
            {label:"మండలం",field:"mandal"}
          ],
          ledgerFields:[
            {label:"గ్రామం పేరు",field:"village"},
            {label:"మండలం",field:"mandal"}
          ]
        }
      }),
      MS:Object.freeze({
        parent:"MS",
        child:"VO",
        parentPlural:"MS",
        childPlural:"VO",
        storageKey:"ms_shg_accounting_v18",
        detailsColumns:4,
        showVillage:false,
        showVoName:false,
        voNameRequired:false,
        villageRequired:false,
        districtRequired:true,
        firstLocationField:"mandal",
        loanTypes:[
          {key:"cif",label:"1. VO CIF"},
          {key:"sgsy",label:"2. SGSY"},
          {key:"pmfme",label:"3. PMFME"},
          {key:"nutrition",label:"4. Nutrition"},
          {key:"education",label:"5. Education"}
        ],
        backupFilename:"ms-vo-backup.json",
        pdf:{
          headerFields:[
            {label:"మండలం",field:"mandal"},
            {label:"జిల్లా",field:"district"}
          ],
          ledgerFields:[
            {label:"మండలం",field:"mandal"},
            {label:"జిల్లా",field:"district"}
          ]
        }
      }),
      SHG:Object.freeze({
        parent:"SHG",
        child:"Member",
        parentPlural:"SHG",
        childPlural:"Members",
        storageKey:"shg_member_accounting_v18",
        detailsColumns:6,
        showVillage:true,
        showVoName:true,
        voNameRequired:true,
        villageRequired:true,
        districtRequired:false,
        firstLocationField:"village",
        loanTypes:[
          {key:"bankLinkage",label:"1. Bank Linkage"},
          {key:"streeNidhi",label:"2. Sree Nidhi"},
          {key:"voCif",label:"3. VO CIF"},
          {key:"internalLoan",label:"4. Internal"}
        ],
        backupFilename:"shg-member-backup.json",
        pdf:{
          headerFields:[
            {label:"గ్రామం",field:"village"},
            {label:"మండలం",field:"mandal"}
          ],
          ledgerFields:[
            {label:"గ్రామం పేరు",field:"village"},
            {label:"మండలం",field:"mandal"}
          ]
        }
      })
    });

    function modeConfig(){return ACCOUNTING_CONFIG[currentMode]||ACCOUNTING_CONFIG.VO;}
    function loanTypesForMode(){return modeConfig().loanTypes||ACCOUNTING_CONFIG.VO.loanTypes;}
    function defaultLoanTypeKey(){const types=loanTypesForMode();return types.length?types[0].key:"cif";}
    function modeConfigStorageKey(mode){
      const base=(ACCOUNTING_CONFIG[mode]||ACCOUNTING_CONFIG.VO).storageKey;
      const uid=window.firebaseCloud?.currentUser?.uid||"anonymous";
      return base+"__user_"+uid;
    }
    function modeKey(){return modeConfigStorageKey(currentMode);}
    function applyAccountingLabels(){
      const c=modeConfig();
      document.body.classList.toggle("shg-mode",c.parent==="SHG");
      const set=(id,text)=>{const e=document.getElementById(id);if(e)e.textContent=text;};
      const setAttr=(id,attr,text)=>{const e=document.getElementById(id);if(e)e.setAttribute(attr,text);};
      set("loginTitle",`Chary's - ${c.parent} DCB & LL Login`);
      set("appTitle",`Chary's - ${c.parent} DCB & LL Dashboard`);
      set("loginVoBtn","VO Login");
      set("loginMsBtn","MS Login");
      set("loginShgBtn","SHG Login");
      updateReportCenterLabels();
      syncReportMonthOptions();
      set("parentSelectionTitle",`${c.parent} Selection & Creation`);
      set("existingParentLabel",`Existing ${c.parent}`);
      set("existingParentOption",`-- Select existing ${c.parent} --`);
      set("homeNewVoBtn",`Create New ${c.parent}`);
      set("newParentLabel",`New ${c.parent} Name`);
      setAttr("newVoName","placeholder",`Enter new ${c.parent} name`);
      set("createVoBtn",`Create ${c.parent}`);
      set("newFinancialYearLabel","Financial Year");
      const fySelect=document.getElementById("newFinancialYear");
      if(fySelect){
        fySelect.innerHTML=`<option value="">-- Select Financial Year --</option>`+FINANCIAL_YEARS.map(y=>`<option value="${y}">${y}</option>`).join("");
        fySelect.value="";
      }
      const detailsFy=document.getElementById("detailsFinancialYear");
      if(detailsFy){
        detailsFy.innerHTML=`<option value="">-- Select Financial Year --</option>`+FINANCIAL_YEARS.map(y=>`<option value="${y}">${y}</option>`).join("");
      }
      set("parentDetailsTitle",`${c.parent} Details`);
      set("parentNameLabel",`${c.parent} Name`);
      setAttr("voName","placeholder",`${c.parent} Name`);

      const villageField=document.getElementById("villageField");
      const villageLabel=document.getElementById("villageLabel");
      const districtLabel=document.getElementById("districtLabel");
      const detailsToolbar=document.getElementById("voDetailsToolbar");
      const linkedVoNameField=document.getElementById("linkedVoNameField");
      if(villageField)villageField.classList.toggle("hidden",!c.showVillage);
      if(linkedVoNameField)linkedVoNameField.classList.toggle("hidden",!c.showVoName);
      if(detailsToolbar){
        detailsToolbar.style.setProperty("--details-cols",String(c.detailsColumns));
        detailsToolbar.classList.toggle("shg-details",c.showVoName);
      }
      const financialYearField=document.getElementById("financialYearField");
      const mandalField=document.getElementById("mandalField");
      const districtField=document.getElementById("districtField");
      if(c.showVoName){
        if(financialYearField)financialYearField.style.gridColumn="3";
        if(villageField)villageField.style.gridColumn="4";
        if(mandalField)mandalField.style.gridColumn="5";
        if(districtField)districtField.style.gridColumn="6";
      }else{
        if(financialYearField)financialYearField.style.gridColumn="2";
        if(villageField)villageField.style.gridColumn=c.showVillage?"3":"";
        if(mandalField)mandalField.style.gridColumn=c.showVillage?"4":"3";
        if(districtField)districtField.style.gridColumn=c.showVillage?"5":"4";
      }
      if(villageLabel)villageLabel.innerHTML=c.villageRequired?"Village <span style=\"color:#c62828\">*</span>":"Village";
      if(districtLabel)districtLabel.innerHTML=c.districtRequired?"District <span style=\"color:#c62828\">*</span>":"District";

      set("linkedVoNameLabel",`VO Name`);
      if(document.getElementById("linkedVoNameLabel")) document.getElementById("linkedVoNameLabel").innerHTML=`VO Name ${c.voNameRequired?'<span style="color:#c62828">*</span>':''}`;
      set("saveVoBtn",`Save ${c.parent}`);
      set("resetBtn",`Delete ${c.parent}`);
      set("childMonthlyTitle",`${c.child} Wise Monthly Collection Data`);
      set("addChildLabel",`Add ${c.child} Name`);
      setAttr("shgNameInput","placeholder",`${c.child} Name`);
      set("addChildBold",`Add ${c.child}`);
      set("addShgBtn",`Add ${c.child}`);
      const childMonthNotice=document.getElementById("childMonthNotice");
      if(childMonthNotice){
        childMonthNotice.textContent=`Add ${c.childPlural} here for this month. Type the name and press Enter or click Add ${c.child}. The new ${c.child} immediately becomes a row in the table from this month onwards.`;
      }
      set("childTableNameHead",`${c.child} Name`);
      set("saveAllBtn",c.parent==="SHG"?`Save All ${c.childPlural}`:`Save All ${c.childPlural}`);
      const loanFilterToolbar=document.getElementById("shgLoanFilterToolbar");
      if(loanFilterToolbar)loanFilterToolbar.classList.remove("hidden");
      const rateField=document.getElementById("interestRateField");
      if(rateField)rateField.classList.remove("hidden");
      const loanTypeLabel=document.querySelector("#loanTypeFilter");
      if(loanTypeLabel){
        loanTypeLabel.innerHTML=loanTypesForMode().map(type=>`<option value="${type.key}">${type.label}</option>`).join("");
      }
      selectedLoanType=loanTypesForMode().some(type=>type.key===selectedLoanType)?selectedLoanType:defaultLoanTypeKey();
      refreshLoanInterestRateInput();
      const memberFilterField=document.getElementById("memberFilter")?.closest(".field");
      if(memberFilterField)memberFilterField.classList.remove("hidden");
      const memberFilterLabel=document.getElementById("memberFilterLabel");
      if(memberFilterLabel)memberFilterLabel.textContent=c.child;
      document.querySelectorAll(".shg-saving-head").forEach(el=>el.classList.toggle("hidden",c.parent!=="SHG"));
      set("allPdfsBtn",`Download ${c.parent} PDF`);
      const h=document.querySelector('link[rel="icon"]');
      if(h)h.href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='14' fill='%2317365d'/%3E%3Ctext x='32' y='42' text-anchor='middle' font-family='Arial,sans-serif' font-size='25' font-weight='700' fill='white'%3E${c.parent}%3C/text%3E%3C/svg%3E";
      document.title=`Chary's - ${c.parent} DCB & LL`;
    }

    window.addEventListener("firebase-cloud-ready",function(e){
      currentMode=(e.detail&&e.detail.mode)||"VO";
      localStorage.setItem(modeKey(),JSON.stringify(e.detail.db||{vos:[]}));
      applyAccountingLabels();
    });

    window.addEventListener("firebase-cloud-ready",function(e){
      currentMode=(e.detail&&e.detail.mode)||currentMode||"VO";
      const cloudDb=e.detail&&e.detail.db;
      db=(cloudDb&&Array.isArray(cloudDb.vos))?cloudDb:{vos:[]};
      localStorage.setItem(modeKey(),JSON.stringify(db));
      selectedVOId=null;
      monthIndex=0;
      selectedLoanType=defaultLoanTypeKey();
      selectedMemberId="ALL";
      markClean();
      refresh();

      // Every successful login must always start on the Home / initial page.
      // If the previous session was logged out from the SHG page, the old
      // selected-VO UI state would otherwise remain hidden behind appShell
      // and appear again after the next login.
      const voDetailsSection=document.getElementById("voDetailsSection");
      if(voDetailsSection)voDetailsSection.classList.add("hidden");
      const homeNewVoBtn=document.getElementById("homeNewVoBtn");
      if(homeNewVoBtn)homeNewVoBtn.style.removeProperty("display");
      const dataManagementSection=document.getElementById("dataManagementSection");
      if(dataManagementSection)dataManagementSection.classList.remove("hidden");
      const newVoForm=document.getElementById("newVoForm");
      if(newVoForm)newVoForm.classList.add("hidden");
      const dashboard=document.getElementById("dashboard");
      if(dashboard)dashboard.classList.add("hidden");
      const newVoName=document.getElementById("newVoName");
      if(newVoName)newVoName.value="";
      const newFinancialYear=document.getElementById("newFinancialYear");
      if(newFinancialYear)newFinancialYear.value="";
      const detailsFinancialYear=document.getElementById("detailsFinancialYear");
      if(detailsFinancialYear)detailsFinancialYear.value="";
      document.getElementById("saveStatus").textContent="Data loaded";
    });

    function readDb(){
      try{
        const x=JSON.parse(localStorage.getItem(modeKey()));
        if(x&&Array.isArray(x.vos))return x;
      }catch(e){}
      return{vos:[]};
    }
    function writeDb(){
      localStorage.setItem(modeKey(),JSON.stringify(db));
      if(window.firebaseCloud) window.firebaseCloud.queueCloudSave(db);
    }

    // Save current screen values and then wait for the Firebase write to
    // finish. Used by both manual and automatic logout.
    window.saveAppDataBeforeLogout = async function(){
      try{
        if(selectedVOId){
          const saved=saveCurrentScreen();
          if(!saved){
            // Even if validation prevents the normal Save VO action,
            // preserve the current database locally before logout.
            localStorage.setItem(modeKey(),JSON.stringify(db));
          }
        }else{
          localStorage.setItem(modeKey(),JSON.stringify(db));
        }

        if(window.firebaseCloud && window.firebaseCloud.saveNowBeforeLogout){
          await window.firebaseCloud.saveNowBeforeLogout(db);
        }
        return true;
      }catch(err){
        console.error("Save before logout failed:",err);
        // localStorage was written before the cloud operation.
        return false;
      }
    };

    function vo(){return db.vos.find(v=>v.id===selectedVOId)||null;}
    function markDirty(){dirty=true;updateDirtyUI();}
    function markClean(){dirty=false;updateDirtyUI();}
    function updateDirtyUI(){const el=document.getElementById("saveStatus");if(el&&dirty)el.textContent="Unsaved changes";}
    function saveCurrentScreen(){
      const v=vo();if(!v)return false;
      const c=modeConfig();
      const name=document.getElementById("voName").value.trim();
      const detailsFy=document.getElementById("detailsFinancialYear");
      const financialYear=detailsFy?String(detailsFy.value||"").trim():"";
      const village=document.getElementById("village").value.trim();
      const linkedVoNameEl=document.getElementById("linkedVoName");
      const linkedVoName=linkedVoNameEl?linkedVoNameEl.value.trim():"";
      const mandal=document.getElementById("mandal").value.trim();
      if(!name){alert(`${c.parent} Name is required.`);document.getElementById("voName").focus();return false;}
      if(c.voNameRequired && !linkedVoName){alert("VO Name is required for SHG.");if(linkedVoNameEl)linkedVoNameEl.focus();return false;}
      if(!FINANCIAL_YEARS.includes(financialYear)){alert("Financial Year is required.");if(detailsFy)detailsFy.focus();return false;}
      if(c.villageRequired && !village){alert("Village is required.");document.getElementById("village").focus();return false;}
      if(!mandal){alert("Mandal is required.");document.getElementById("mandal").focus();return false;}
      const district=document.getElementById("district").value.trim();
      if(c.districtRequired && !district){alert(`District is required for ${c.parent}.`);document.getElementById("district").focus();return false;}

      // Keep the selected Financial Year as part of the parent record and
      // immediately rebuild the Apr-Mar month keys when the year changes.
      const oldFinancialYear=FINANCIAL_YEARS.includes(v.financialYear)?v.financialYear:"";
      v.name=name;
      v.voName=linkedVoName;
      v.financialYear=financialYear;
      v.village=village;
      v.mandal=mandal;
      v.district=district;
      if(oldFinancialYear && oldFinancialYear!==financialYear){
        rekeyMonthsForFinancialYear(v,oldFinancialYear,financialYear);
      }
      currentFinancialYear=financialYear;
      MONTHS=buildMonths(currentFinancialYear);

      const rateInput=document.getElementById("shgRateInput");
      const currentRate=rateInput?Number(rateInput.value):getCurrentLoanInterestRate(v);
      if(!Number.isFinite(currentRate)||currentRate<0||currentRate>100){alert("Enter a valid interest rate between 0 and 100%.");if(rateInput)rateInput.focus();return false;}
      ensureIndividualLoanInterestRates(v);
      const currentLoanKey=selectedLoanType||defaultLoanTypeKey();
      v.loanInterestRates[currentLoanKey]=currentRate;
      v.interestRate=currentRate;
      const screenEntries=filteredRowEntries(v);
      screenEntries.forEach((entry,rowIndex)=>{
        const s=entry.member;
        const account=activeAccount(entry);
        const startIdx=Number.isInteger(account.startMonthIndex)?account.startMonthIndex:(Number.isInteger(s.startMonthIndex)?s.startMonthIndex:0);
        if(monthIndex<startIdx)return;
        const n=document.getElementById("name-"+rowIndex);if(n&&n.value.trim())s.name=n.value.trim();
        account.name=s.name;
        account.interestRate=currentRate;
        const key=MONTHS[monthIndex][0];
        const raw=getRowData(rowIndex);
        const april=(monthIndex===0);
        const creationMonth=(monthIndex===startIdx && startIdx>0);
        const nextMonthStart=(monthIndex===startIdx+1 && startIdx>0);
        if(april){
        }else if(creationMonth){
          raw.opening=0;raw.prevPrincipal=0;raw.prevInterest=0;raw.demandPrincipal=0;raw.principalCollection=0;raw.interestCollection=0;
        }else if(nextMonthStart){
          const prev=lastConsideredMonth(account,monthIndex);
          if(prev){const pc=calc(prev.data);raw.opening=pc.totalLoanBalance;raw.prevPrincipal=pc.balancePrincipal;raw.prevInterest=pc.balanceInterest;}
        }else{
          const prev=lastConsideredMonth(account,monthIndex);
          const pc=prev?calc(prev.data):null;
          if(pc){raw.opening=pc.totalLoanBalance;raw.prevPrincipal=pc.balancePrincipal;raw.prevInterest=pc.balanceInterest;}
        }
        raw.demandInterest=monthlyInterest(raw.opening,currentRate);

        /*
         * Current Month Principal is valid data by itself.  The value the
         * user has entered on the current screen is authoritative for this
         * month.  Immediately propagate that value through every later
         * saved month so repeated edits/saves always remain consistent.
         */
        const demandPrincipalEntered=hasValue(document.getElementById("demandP-"+rowIndex)?.value);
        if(monthIsConsidered(raw)||hasSavingData||demandPrincipalEntered){
          account.months[key]=raw;

          for(let mi=monthIndex+1;mi<MONTHS.length;mi++){
            const futureKey=MONTHS[mi][0];
            const future=account.months[futureKey];
            if(!future)continue;
            const previous=account.months[MONTHS[mi-1][0]];
            if(previous && hasValue(previous.demandPrincipal)){
              future.demandPrincipal=Number(previous.demandPrincipal)||0;
              future.demandInterest=monthlyInterest(future.opening,account.interestRate);
              account.months[futureKey]=future;
            }
          }
        }else if(account.months[key]){
          delete account.months[key];
        }
      });
      writeDb();refreshVOSelect();markClean();document.getElementById("saveStatus").textContent="Saved";return true;
    }

    function confirmSwitch(action){
      if(!dirty)return true;
      const proceed=confirm(
        "You have unsaved changes.\n\n" +
        "Press OK to continue without saving, or Cancel and save the details."
      );
      if(proceed){
        /* Discard only the unsaved screen changes. Reload the last saved DB
         * before moving to another VO/month/new-VO flow. */
        db=readDb();
        markClean();
        return true;
      }
      return false;
    }
    window.addEventListener("beforeunload",function(e){if(dirty){e.preventDefault();e.returnValue="Unsaved changes will be lost.";}});

    const SHG_LOAN_TYPES=ACCOUNTING_CONFIG.SHG.loanTypes;
    function isSHGMode(){return modeConfig().parent==="SHG";}
    function loanLabel(key){const x=loanTypesForMode().find(t=>t.key===key);return x?x.label:key;}
    function ensureLoanData(v){
      if(!v||!Array.isArray(v.shgs))return;
      const types=loanTypesForMode();
      ensureIndividualLoanInterestRates(v);
      v.shgs.forEach(member=>{
        if(!member.loans)member.loans={};
        types.forEach((type,index)=>{
          const loan=member.loans[type.key]||{};
          /* Preserve legacy VO/MS monthly data by migrating it into CIF.
             Existing SHG data remains in Bank Linkage. */
          if(!loan.months){
            if(member.months && Object.keys(member.months).length && index===0) loan.months=member.months;
            else loan.months={};
          }
          if(!Number.isInteger(loan.startMonthIndex))loan.startMonthIndex=Number.isInteger(member.startMonthIndex)?member.startMonthIndex:0;
          const configuredRate=Number(v.loanInterestRates[type.key]);
          const legacyRate=Number(loan.interestRate);
          if(Number.isFinite(configuredRate)&&configuredRate>=0&&configuredRate<=100){
            loan.interestRate=configuredRate;
          }else if(Number.isFinite(legacyRate)&&legacyRate>=0&&legacyRate<=100){
            v.loanInterestRates[type.key]=legacyRate;
            loan.interestRate=legacyRate;
          }else{
            loan.interestRate=Number(v.loanInterestRates[type.key]||12);
          }
          loan.name=member.name;
          member.loans[type.key]=loan;
        });
      });
    }
    /* Backward-compatible name used by older SHG-specific code paths. */
    function ensureShgLoanData(v){ensureLoanData(v);}
    function populateMemberFilter(){
      const sel=document.getElementById("memberFilter");
      if(!sel)return;
      const v=vo();
      const childLabel=modeConfig().child||"Member";
      const wanted=selectedMemberId||"ALL";
      sel.innerHTML=`<option value="ALL">ALL ${childLabel}s</option>`;
      (v&&Array.isArray(v.shgs)?v.shgs:[]).forEach((child,i)=>{
        const o=document.createElement("option");
        o.value=child.id;
        o.textContent=child.name||(`${childLabel} ${i+1}`);
        sel.appendChild(o);
      });
      sel.value=(wanted==="ALL"||[...sel.options].some(o=>o.value===wanted))?wanted:"ALL";
      selectedMemberId=sel.value;
    }
    function filteredRowEntries(v){
      if(!v)return [];
      ensureLoanData(v);
      const out=[];
      (v.shgs||[]).forEach((member,mi)=>{
        if(selectedMemberId!=="ALL"&&member.id!==selectedMemberId)return;
        const loan=member.loans&&member.loans[selectedLoanType];
        if(loan)out.push({member,loan,index:mi,key:selectedLoanType,displayName:member.name||`${modeConfig().child} ${mi+1}`});
      });
      return out;
    }
    function selectedEntryByRow(i){return filteredRowEntries(vo())[i]||null;}
    function activeAccount(entry){return entry.loan||entry.member;}
    function syncLoanFilterState(){
      const loanSel=document.getElementById("loanTypeFilter"),memberSel=document.getElementById("memberFilter");
      if(loanSel)loanSel.value=selectedLoanType;
      populateMemberFilter();
      if(memberSel)memberSel.value=selectedMemberId;
    }

    function blank(){return{opening:0,prevPrincipal:0,prevInterest:0,demandPrincipal:0,demandInterest:0,principalCollection:0,interestCollection:0,newLoan:0,savingOpening:0,savingCurrent:0,savingDisbursed:0};}
    function hasValue(x){return x!==undefined&&x!==null&&String(x).trim()!=="";}
    function monthIsConsidered(d){
      if(!d)return false;

      /*
       * A month is considered entered ONLY when Principal Collection
       * or Interest Collection has a value entered.
       *
       * IMPORTANT:
       * - Blank / empty collection fields => month is NOT considered.
       * - 0 is a valid entered collection value => month IS considered.
       * - Opening Balance, Previous Due, Demand, and New Loan do NOT
       *   independently make a month eligible for PDF output.
       * - This does not change calc() or any calculation formula.
       */
      const principalEntered = hasValue(d.principalCollection);
      const interestEntered  = hasValue(d.interestCollection);
      const demandPrincipalEntered = hasValue(d.demandPrincipal);

      // A saved Current Month Principal also makes the month reportable.
      // This allows Save All SHGs to materialize every month and include
      // every SHG/month in reports and PDFs even when no collection exists.
      return principalEntered || interestEntered || demandPrincipalEntered;
    }
    function lastConsideredMonth(shg,idx){
      if(!shg||!shg.months)return null;
      for(let j=idx-1;j>=0;j--){const d=shg.months[MONTHS[j][0]];if(monthIsConsidered(d))return {index:j,data:d};}
      return null;
    }
    function num(id){return Number(document.getElementById(id).value)||0;}
    function monthlyInterest(opening, rate){return Math.round((Number(opening)||0)*(Number(rate)||0)/100/12);}
    function fmt(n){return Number(n||0).toLocaleString("en-IN",{minimumFractionDigits:0,maximumFractionDigits:0});}
    function esc(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
    function calc(d){
      const prevPrincipal = Number(d.prevPrincipal) || 0;
      const prevInterest = Number(d.prevInterest) || 0;
      const demandPrincipal = Number(d.demandPrincipal) || 0;
      const demandInterest = Number(d.demandInterest) || 0;
      const principalCollection = Number(d.principalCollection) || 0;
      const interestCollection = Number(d.interestCollection) || 0;
      const opening = Number(d.opening) || 0;
      const newLoan = Number(d.newLoan) || 0;

      return {
        balancePrincipal: prevPrincipal + demandPrincipal - principalCollection,
        balanceInterest: prevInterest + demandInterest - interestCollection,
        totalCollection: principalCollection + interestCollection,
        totalLoanBalance: opening - principalCollection + newLoan
      };
    }

    function refreshVOSelect(){
     const s=document.getElementById("voSelect");s.innerHTML='<option value="" id="existingParentOption">-- Select existing --</option>';
     db.vos.forEach(v=>{const o=document.createElement("option");o.value=v.id;o.textContent=v.name||"(Unnamed VO)";s.appendChild(o);});
     s.value=selectedVOId||"";
    }
    function refresh(){
     refreshVOSelect();
     const v=vo(),dash=document.getElementById("dashboard");
     if(v){
       currentFinancialYear=FINANCIAL_YEARS.includes(v.financialYear)?v.financialYear:"";
       MONTHS=buildMonths(currentFinancialYear);
     }
     if(v && (v.interestRate===undefined||v.interestRate===null) && v.shgs.length) v.interestRate=Number(v.shgs[0].interestRate||12);
     dash.classList.toggle("hidden",!v);
     if(!v)return;
     document.getElementById("voName").value=v.name;
     const linkedVoName=document.getElementById("linkedVoName");
     if(linkedVoName)linkedVoName.value=v.voName||"";
     const detailsFy=document.getElementById("detailsFinancialYear");
     if(detailsFy)detailsFy.value=FINANCIAL_YEARS.includes(v.financialYear)?v.financialYear:"";
     document.getElementById("village").value=v.village||"";
     document.getElementById("mandal").value=v.mandal||"";
     document.getElementById("district").value=v.district||"";
     ensureLoanData(v);
     refreshLoanInterestRateInput();
     syncLoanFilterState();
     renderMonths();renderRows();
    }

    function goHome(){
      if(!confirmSwitch("returning to the initial page"))return;
      selectedVOId=null;
      monthIndex=0;
      currentFinancialYear="";
      MONTHS=buildMonths(currentFinancialYear);
      document.getElementById("voDetailsSection").classList.add("hidden");
      const homeNewVoBtn=document.getElementById("homeNewVoBtn");
      if(homeNewVoBtn)homeNewVoBtn.style.setProperty("display","inline-block","important");
      document.getElementById("dashboard").classList.add("hidden");
      document.getElementById("dataManagementSection").classList.remove("hidden");
      document.getElementById("newVoForm").classList.add("hidden");
      document.getElementById("newVoName").value="";
      document.getElementById("saveStatus").textContent="";
      markClean();
      refresh();
      document.getElementById("voSelect").focus();
    }

    function createVO(){
      const name=document.getElementById("newVoName").value.trim();
      const fySelect=document.getElementById("newFinancialYear");
      const financialYear=fySelect?String(fySelect.value||"").trim():"";
      if(!name){alert(`Enter a ${modeConfig().parent} name.`);return;}
      if(!FINANCIAL_YEARS.includes(financialYear)){alert("Please select a valid Financial Year.");if(fySelect)fySelect.focus();return;}
      if(db.vos.some(x=>String(x.name||"").trim().toLowerCase()===name.toLowerCase())){alert(`A ${modeConfig().parent} with this name already exists. Select it from the dropdown.`);return;}
      const v={id:"VO-"+Date.now()+"-"+Math.random().toString(36).slice(2),name:name,voName:"",financialYear:financialYear,village:"",mandal:"",district:"",shgs:[],loanInterestRates:{}};
      loanTypesForMode().forEach(type=>{v.loanInterestRates[type.key]=12;});
      db.vos.push(v);selectedVOId=v.id;monthIndex=0;
      currentFinancialYear=financialYear;
      MONTHS=buildMonths(currentFinancialYear);
      document.getElementById("newVoName").value="";
      document.getElementById("newVoForm").classList.add("hidden");
      refresh();
      document.getElementById("voDetailsSection").classList.remove("hidden");
      // A newly created VO is now on the selected-VO / SHG page.
      // Keep VO Selection & Creation visible on the SHG page so another VO
      // can be selected or a new VO can be created from there.
      const homeNewVoBtn=document.getElementById("homeNewVoBtn");
      if(homeNewVoBtn)homeNewVoBtn.style.removeProperty("display");
      // Data Management belongs only on the Home / initial page.
      document.getElementById("dataManagementSection").classList.add("hidden");
      markDirty();
      setTimeout(()=>document.getElementById(modeConfig().firstLocationField).focus(),50);
    }

    function ensureIndividualLoanInterestRates(v){
      if(!v)return;
      if(!v.loanInterestRates || typeof v.loanInterestRates!=="object")v.loanInterestRates={};
      const fallback=Number(v.interestRate);
      const fallbackRate=Number.isFinite(fallback)&&fallback>=0&&fallback<=100?fallback:12;
      loanTypesForMode().forEach(type=>{
        if(v.loanInterestRates[type.key]===undefined || v.loanInterestRates[type.key]===null || !Number.isFinite(Number(v.loanInterestRates[type.key]))){
          const existing=v.shgs?.[0]?.loans?.[type.key]?.interestRate;
          v.loanInterestRates[type.key]=Number.isFinite(Number(existing))?Number(existing):fallbackRate;
        }
      });
    }

    function getCurrentLoanInterestRate(v){
      if(!v)return 12;
      ensureIndividualLoanInterestRates(v);
      const key=selectedLoanType||defaultLoanTypeKey();
      return Number(v.loanInterestRates[key] ?? 12);
    }

    function refreshLoanInterestRateInput(){
      const v=vo(),el=document.getElementById("shgRateInput");
      if(!el)return;
      if(!v){el.value="12";return;}
      ensureIndividualLoanInterestRates(v);
      el.value=getCurrentLoanInterestRate(v);
    }

    function updateInterestRateLive(){
      const v=vo(),el=document.getElementById("shgRateInput");if(!v||!el)return;
      const rate=Number(el.value);
      if(!Number.isFinite(rate)||rate<0||rate>100)return;
      ensureIndividualLoanInterestRates(v);
      const key=selectedLoanType||defaultLoanTypeKey();
      v.loanInterestRates[key]=rate;
      ensureLoanData(v);
      v.shgs.forEach(s=>{
        s.loans[key].interestRate=rate;
      });
      /* Keep the legacy parent/member rate as a fallback only. */
      v.interestRate=rate;
      renderRows();markDirty();
    }

    function addSHG(){
      const v=vo();if(!v){alert(`Please create or select a ${modeConfig().parent} first.`);return;}
      const input=document.getElementById("shgNameInput");
      const rateInput=document.getElementById("shgRateInput");
      const name=input.value.trim();
      const rate=Number(rateInput.value);
      if(!name){alert(`Type ${modeConfig().child} name first.`);input.focus();return;}
      if(!Number.isFinite(rate)||rate<0||rate>100){alert("Enter a valid interest rate between 0 and 100%.");rateInput.focus();return;}
      if(v.shgs.some(s=>String(s.name||"").trim().toLowerCase()===name.toLowerCase())){alert(`That ${modeConfig().child} already exists in this ${modeConfig().parent}.`);input.select();return;}
      ensureIndividualLoanInterestRates(v);
      const selectedKey=selectedLoanType||defaultLoanTypeKey();
      v.loanInterestRates[selectedKey]=rate;
      const member={id:"SHG-"+Date.now()+"-"+Math.random().toString(36).slice(2),name:name,interestRate:rate,startMonthIndex:monthIndex,months:{},loans:{}};
      v.shgs.push(member);
      loanTypesForMode().forEach(type=>{
        const typeRate=Number(v.loanInterestRates[type.key]??12);
        member.loans[type.key]={name:name,interestRate:typeRate,startMonthIndex:monthIndex,months:{}};
      });
      input.value="";v.interestRate=rate;refreshLoanInterestRateInput();markDirty();populateMemberFilter();renderRows();
      document.getElementById("saveStatus").textContent=`${modeConfig().child} added — save to keep changes`;
      input.focus();
    }

    function renderMonths(){
     const box=document.getElementById("monthTabs");box.innerHTML="";
     MONTHS.forEach((m,i)=>{
       const b=document.createElement("button");
       b.type="button";
       b.textContent=m[0];
       if(i===monthIndex)b.classList.add("active");
       b.onclick=()=>{
         if(i===monthIndex)return;

         /* Auto-save the month currently on screen before changing tabs.
          * This prevents entered SHG values from disappearing just because
          * the user moved to another month. */
         if(dirty && !saveCurrentScreen())return;

         monthIndex=i;
         refresh();
       };
       box.appendChild(b);
     });
    }

    function getRowData(i){
      const vals={};
      ["opening","prevP","prevI","demandP","demandI","newLoan"].forEach(k=>{
        const el=document.getElementById(k+"-"+i); vals[k]=el?Number(el.value)||0:0;
      });
      const cp=document.getElementById("collectP-"+i),ci=document.getElementById("collectI-"+i);
      const so=document.getElementById("savingOpening-"+i),sc=document.getElementById("savingCurrent-"+i),sd=document.getElementById("savingDisbursed-"+i);
      return {opening:vals.opening,prevPrincipal:vals.prevP,prevInterest:vals.prevI,demandPrincipal:vals.demandP,demandInterest:vals.demandI,
        principalCollection:cp?String(cp.value).trim():"",interestCollection:ci?String(ci.value).trim():"",newLoan:vals.newLoan,
        savingOpening:so?Number(so.value)||0:0,savingCurrent:sc?Number(sc.value)||0:0,savingDisbursed:sd?Number(sd.value)||0:0};
    }

    function fitShgNameColumn(){
      const table=document.querySelector("#entryBody")?.closest("table.entry");
      if(!table)return;

      const header=table.querySelector("thead th:nth-child(2)");
      const cells=[...table.querySelectorAll("tbody td:nth-child(2)")];
      const inputs=[...table.querySelectorAll("tbody td:nth-child(2) input.name")];

      /* Measure using the actual SHG-name input font so the column matches
         the longest entered name. Header text is the minimum width. */
      const probe=document.createElement("span");
      const sample=inputs[0] || header;
      const cs=sample ? getComputedStyle(sample) : getComputedStyle(table);
      probe.style.cssText=[
        "position:absolute",
        "visibility:hidden",
        "white-space:nowrap",
        "width:auto",
        "height:auto",
        "left:-99999px",
        "top:-99999px",
        `font:${cs.font}`,
        `font-family:${cs.fontFamily}`,
        `font-size:${cs.fontSize}`,
        `font-weight:${cs.fontWeight}`,
        `letter-spacing:${cs.letterSpacing}`
      ].join(";");
      document.body.appendChild(probe);

      probe.textContent=pdfChildLabel()+" Name";
      let width=probe.getBoundingClientRect().width;

      inputs.forEach(input=>{
        const value=input.value || "";
        probe.textContent=value;
        width=Math.max(width,probe.getBoundingClientRect().width);
      });

      /* Room for the input's left/right padding and cell borders. */
      width=Math.ceil(width)+18;

      if(header)header.style.width=width+"px";
      cells.forEach(cell=>{
        cell.style.width=width+"px";
        cell.style.minWidth=width+"px";
      });

      inputs.forEach(input=>{
        input.style.width="100%";
        input.style.minWidth="0";
        input.style.boxSizing="border-box";
        input.style.overflow="hidden";
        input.style.textOverflow="clip";
        input.style.whiteSpace="nowrap";
      });

      probe.remove();
    }

    function renderRows(){
     const body=document.getElementById("entryBody");body.innerHTML="";
     const v=vo();if(!v)return;
     if(!Array.isArray(v.shgs))v.shgs=[];
     ensureLoanData(v);
     const entries=filteredRowEntries(v);
     const april=(monthIndex===0);
     entries.forEach((entry,rowIndex)=>{
      const s=entry.member;
      const account=activeAccount(entry);
      const configuredRate=Number(v.loanInterestRates?.[entry.key]);
      if(Number.isFinite(configuredRate)&&configuredRate>=0&&configuredRate<=100){
        account.interestRate=configuredRate;
      }else if(account.interestRate===undefined||account.interestRate===null||account.interestRate===""){
        account.interestRate=12;
      }
      const startIdx=Number.isInteger(account.startMonthIndex)?account.startMonthIndex:(Number.isInteger(s.startMonthIndex)?s.startMonthIndex:0);
      if(monthIndex<startIdx)return;
      const key=MONTHS[monthIndex][0],saved=account.months[key],d=saved||blank();
      if(!saved&&monthIndex===0){d.principalCollection=0;d.interestCollection=0;}
      let opening=d.opening, prevP=d.prevPrincipal, prevI=d.prevInterest;
      /*
       * CURRENT MONTH PRINCIPAL - FORWARD PROPAGATION
       * ------------------------------------------------
       * April (or the account creation month) is the starting value.
       * Every following month always inherits the immediately previous
       * month's Current Month Principal, even if the current month already
       * has saved data.  This deliberately affects ONLY demandPrincipal.
       */
      /*
       * CURRENT MONTH PRINCIPAL
       * ------------------------
       * The saved value in the current month is authoritative for that
       * month.  Every later month inherits the immediately previous
       * month's value.  This allows a user to change any month and make
       * that new value flow forward from that month onward.
       */
      let demandP=Number(d.demandPrincipal)||0;
      if(!saved && monthIndex>0){
        demandP=previousMonthDemandPrincipal(account,monthIndex);
      }
      const creationMonth=(!april && monthIndex===startIdx && startIdx>0);
      const nextMonthStart=(!april && monthIndex===startIdx+1 && startIdx>0);
      if(creationMonth){
        opening=0;prevP=0;prevI=0;demandP=0;
        d.principalCollection=0;d.interestCollection=0;
      }else if(nextMonthStart){
        const prev=lastConsideredMonth(account,monthIndex);
        if(prev){const pc=calc(prev.data);opening=pc.totalLoanBalance;prevP=pc.balancePrincipal;prevI=pc.balanceInterest;}
      }else if(!april){
        const prev=lastConsideredMonth(account,monthIndex);
        if(prev){const pc=calc(prev.data);opening=pc.totalLoanBalance;prevP=pc.balancePrincipal;prevI=pc.balanceInterest;}
      }
      const demandI=monthlyInterest(opening,account.interestRate);
      const c=calc({opening,prevPrincipal:prevP,prevInterest:prevI,demandPrincipal:demandP,demandInterest:demandI,principalCollection:d.principalCollection,interestCollection:d.interestCollection,newLoan:d.newLoan});
      const totalDemandP=prevP+demandP,totalDemandI=prevI+demandI;
      const locked=(x)=>x?' disabled':'';
      /* From May onward, opening loan balance and previous due balances are
         carried forward and must not be manually edited in any login mode.
         April remains the editable starting month. */
      const lockOpening=(monthIndex>0)||creationMonth||nextMonthStart;
      const lockPrevP=(monthIndex>0)||creationMonth||nextMonthStart;
      const lockPrevI=(monthIndex>0)||creationMonth||nextMonthStart;
      const lockDemandP=creationMonth;
      const lockCollect=creationMonth;
      /* SHG saving rule: previous month's closing saving becomes this month's
         opening saving.  It is locked whenever a previous month exists. */
      let savingOpening=Number(d.savingOpening)||0;
      const savingCurrent=Number(d.savingCurrent)||0;
      const savingDisbursed=Number(d.savingDisbursed)||0;
      let savingOpeningLocked=false;
      if(isSHGMode() && monthIndex>0){
        const prevKey=MONTHS[monthIndex-1][0];
        const prevData=account.months&&account.months[prevKey];
        if(prevData){
          savingOpening=(Number(prevData.savingOpening)||0)+(Number(prevData.savingCurrent)||0)-(Number(prevData.savingDisbursed)||0);
        }else{
          savingOpening=0;
        }
        d.savingOpening=savingOpening;
        savingOpeningLocked=true;
      }
      const savingClosing=savingOpening+savingCurrent-savingDisbursed;
      const savingCells=isSHGMode()
        ? '<td class="shg-saving-cell"><input type="number" id="savingOpening-'+rowIndex+'" value="'+savingOpening+'"'+(savingOpeningLocked?' disabled':'')+' oninput="window.recalc('+rowIndex+')"></td>'+
          '<td class="shg-saving-cell"><input type="number" id="savingCurrent-'+rowIndex+'" value="'+savingCurrent+'" oninput="window.recalc('+rowIndex+')"></td>'+
          '<td class="shg-saving-cell"><input type="number" id="savingDisbursed-'+rowIndex+'" value="'+savingDisbursed+'" oninput="window.recalc('+rowIndex+')"></td>'+
          '<td class="shg-saving-cell"><input type="number" class="calc" id="savingClosing-'+rowIndex+'" value="'+savingClosing+'" disabled></td>'
        : '';
      const tr=document.createElement("tr");tr.id="row-"+rowIndex;
      tr.innerHTML=
      '<td>'+(rowIndex+1)+'</td>'+
      '<td><input class="name" id="name-'+rowIndex+'" value="'+esc(s.name)+'"></td>'+
      savingCells+
      '<td><input type="number" id="opening-'+rowIndex+'" value="'+opening+'"'+locked(lockOpening)+' oninput="window.recalc('+rowIndex+')"></td>'+
      '<td><input type="number" id="prevP-'+rowIndex+'" value="'+prevP+'"'+locked(lockPrevP)+' oninput="window.recalc('+rowIndex+')"></td>'+
      '<td><input type="number" id="prevI-'+rowIndex+'" value="'+prevI+'"'+locked(lockPrevI)+' oninput="window.recalc('+rowIndex+')"></td>'+
      '<td><input type="number" id="demandP-'+rowIndex+'" value="'+demandP+'"'+locked(lockDemandP)+' oninput="window.recalc('+rowIndex+')"></td>'+
      '<td><input type="number" id="demandI-'+rowIndex+'" value="'+demandI+'" disabled></td>'+
      '<td><input type="number" id="totalDP-'+rowIndex+'" value="'+totalDemandP+'" disabled></td>'+
      '<td><input type="number" id="totalDI-'+rowIndex+'" value="'+totalDemandI+'" disabled></td>'+
      '<td><input type="number" id="collectP-'+rowIndex+'" value="'+d.principalCollection+'"'+locked(lockCollect)+' oninput="window.recalc('+rowIndex+')"></td>'+
      '<td><input type="number" id="collectI-'+rowIndex+'" value="'+d.interestCollection+'"'+locked(lockCollect)+' oninput="window.recalc('+rowIndex+')"></td>'+
      '<td><input type="number" id="newLoan-'+rowIndex+'" value="'+d.newLoan+'" oninput="window.recalc('+rowIndex+')"></td>'+
      '<td><input type="number" class="calc" id="totalL-'+rowIndex+'" value="'+Number(c.totalLoanBalance||0)+'" disabled></td>'+
      '<td><button type="button" class="success" onclick="window.saveRow('+rowIndex+')">Save</button></td>'+
      '<td><button type="button" class="danger shg-delete-btn" onclick="window.deleteSHG('+entry.index+')">Delete</button></td>';
      body.appendChild(tr);
     });
     fitShgNameColumn();
     const colspan=isSHGMode()?19:15;
     if(!entries.length)body.innerHTML='<tr><td colspan="'+colspan+'" style="text-align:center;padding:22px">No '+(isSHGMode()?"members":"records")+' for the selected filter.</td></tr>';
    }

    window.recalc=function(i){
     const v=vo();if(!v)return;
     const entry=selectedEntryByRow(i);if(!entry)return;
     const account=activeAccount(entry);
     const d=getRowData(i);
     const rateEl=document.getElementById("shgRateInput");
     const liveRate=rateEl?Number(rateEl.value):Number(v.interestRate!==undefined?v.interestRate:(account.interestRate||0));
     const rate=Number.isFinite(liveRate)&&liveRate>=0?liveRate:0;
     if(Number.isFinite(liveRate)&&liveRate>=0&&liveRate<=100){v.interestRate=liveRate;v.shgs.forEach(s=>s.interestRate=liveRate);}
     if(isSHGMode()){
       const so=document.getElementById("savingOpening-"+i),sc=document.getElementById("savingCurrent-"+i),sd=document.getElementById("savingDisbursed-"+i),sx=document.getElementById("savingClosing-"+i);
       if(so&&sc&&sd&&sx){
         let opening=Number(so.value)||0;
         if(monthIndex>0){
           const prevKey=MONTHS[monthIndex-1][0];
           const prevData=account.months&&account.months[prevKey];
           opening=prevData ? (Number(prevData.savingOpening)||0)+(Number(prevData.savingCurrent)||0)-(Number(prevData.savingDisbursed)||0) : 0;
           so.value=opening;
           so.disabled=true;
         }
         sx.value=opening+(Number(sc.value)||0)-(Number(sd.value)||0);
       }
     }
     markDirty();
     const april=(monthIndex===0);
     const startIdx=Number.isInteger(account.startMonthIndex)?account.startMonthIndex:(Number.isInteger(entry.member.startMonthIndex)?entry.member.startMonthIndex:0);
     const creationMonth=(!april && monthIndex===startIdx && startIdx>0);
     const nextMonthStart=(!april && monthIndex===startIdx+1 && startIdx>0);
     let prevP=d.prevPrincipal,prevI=d.prevInterest,demandP=d.demandPrincipal,opening=d.opening;
     if(creationMonth){opening=0;prevP=0;prevI=0;demandP=0;d.principalCollection=0;d.interestCollection=0;}
     else if(nextMonthStart){const prev=safePrevMonth(account,monthIndex);if(prev){const pc=calc(prev);opening=pc.totalLoanBalance;prevP=pc.balancePrincipal;prevI=pc.balanceInterest;}}
     else if(!april){const prev=safePrevMonth(account,monthIndex);if(prev){const pc=calc(prev);opening=pc.totalLoanBalance;prevP=pc.balancePrincipal;prevI=pc.balanceInterest;}}
     const demandI=monthlyInterest(opening,rate);
     const interestEl=document.getElementById("demandI-"+i);if(interestEl)interestEl.value=demandI;
     const totalDP=prevP+demandP,totalDI=prevI+demandI;
     const c=calc({...d,opening,prevPrincipal:prevP,prevInterest:prevI,demandPrincipal:demandP,demandInterest:demandI});
     const ids=[["totalDP",totalDP],["totalDI",totalDI],["balP",c.balancePrincipal],["balI",c.balanceInterest],["totalC",c.totalCollection],["totalL",c.totalLoanBalance]];
     ids.forEach(([id,val])=>{const el=document.getElementById(id+"-"+i);if(el){if(el.tagName==="INPUT")el.value=Number(val||0);else el.textContent=fmt(val);}});
    }

    function previousMonthDemandPrincipal(shg,idx){
     if(!shg||idx<=0||!shg.months)return 0;
     const prev=shg.months[MONTHS[idx-1][0]];
     return prev && hasValue(prev.demandPrincipal)
       ? Number(prev.demandPrincipal)||0
       : 0;
    }

    function safePrevMonth(shg,idx){
     if(!shg||idx<=0)return null;
     return shg.months[MONTHS[idx-1][0]]||null;
    }


    window.deleteSHG=function(i){
      const v=vo();
      if(!v||!v.shgs[i])return;
      const name=String(v.shgs[i].name||"").trim()||(modeConfig().child+" "+(i+1));
      if(!confirm("Delete "+name+"?\n\nThis will permanently remove this "+modeConfig().child+" and all of its monthly data from the current "+modeConfig().parent+"."))return;
      v.shgs.splice(i,1);
      writeDb();markClean();populateMemberFilter();renderRows();
      document.getElementById("saveStatus").textContent="Deleted "+name;
    };

    window.removeSHG=function(i){
      const v=vo();if(!v||!v.shgs[i])return;
      const name=v.shgs[i].name||(modeConfig().child+" "+(i+1));
      if(!confirm('Remove '+modeConfig().child+' "'+name+'"?\n\nAll monthly data for this '+modeConfig().child+' will be deleted from this '+modeConfig().parent+'.'))return;
      v.shgs.splice(i,1);writeDb();markDirty();populateMemberFilter();renderRows();
      document.getElementById("saveStatus").textContent=`${modeConfig().child} removed — save to keep changes`;
    };

    function saveVisibleNamesOnly(){
      const v=vo();if(!v)return;
      filteredRowEntries(v).forEach((entry,rowIndex)=>{const n=document.getElementById("name-"+rowIndex);if(n&&n.value.trim())entry.member.name=n.value.trim();});
      if(isSHGMode())ensureShgLoanData(v);
      writeDb();
    }

    window.saveRow=async function(i){
     const v=vo();if(!v)return;
     const entry=selectedEntryByRow(i);if(!entry)return;
     const s=entry.member,account=activeAccount(entry),name=document.getElementById("name-"+i).value.trim();
     const startIdx=Number.isInteger(account.startMonthIndex)?account.startMonthIndex:(Number.isInteger(s.startMonthIndex)?s.startMonthIndex:0);
     const april=(monthIndex===0);
     if(!name){alert(`${modeConfig().child} name cannot be blank.`);return;}
     const rateEl=document.getElementById("shgRateInput"),rate=rateEl?Number(rateEl.value):Number(v.interestRate!==undefined?v.interestRate:(account.interestRate||0));
     if(!Number.isFinite(rate)||rate<0||rate>100){alert("Enter a valid interest rate between 0 and 100%.");if(rateEl)rateEl.focus();return;}
     v.interestRate=rate;v.shgs.forEach(x=>x.interestRate=rate);s.name=name;account.name=name;account.interestRate=rate;
     if(monthIndex<startIdx){alert(`This ${modeConfig().child} was created in ${MONTHS[startIdx][1]}. Previous months do not require data.`);return;}
     const raw=getRowData(i),creationMonth=(!april&&monthIndex===startIdx&&startIdx>0),nextMonthStart=(!april&&monthIndex===startIdx+1&&startIdx>0);
     if(isSHGMode() && monthIndex>0){
       const prevKey=MONTHS[monthIndex-1][0];
       const prevData=account.months&&account.months[prevKey];
       raw.savingOpening=prevData
         ? (Number(prevData.savingOpening)||0)+(Number(prevData.savingCurrent)||0)-(Number(prevData.savingDisbursed)||0)
         : 0;
     }
     if(creationMonth){raw.opening=0;raw.prevPrincipal=0;raw.prevInterest=0;raw.demandPrincipal=0;raw.principalCollection=0;raw.interestCollection=0;}
     else if(nextMonthStart){const prev=lastConsideredMonth(account,monthIndex);const pc=prev?calc(prev.data):null;if(pc){raw.opening=pc.totalLoanBalance;raw.prevPrincipal=pc.balancePrincipal;raw.prevInterest=pc.balanceInterest;}}
     else if(!april){const prev=lastConsideredMonth(account,monthIndex);const pc=prev?calc(prev.data):null;if(pc){raw.opening=pc.totalLoanBalance;raw.prevPrincipal=pc.balancePrincipal;raw.prevInterest=pc.balanceInterest;}}
     raw.demandInterest=monthlyInterest(raw.opening,rate);
     const hasSavingData=isSHGMode() && [raw.savingOpening,raw.savingCurrent,raw.savingDisbursed].some(n=>(Number(n)||0)!==0);
     const demandPrincipalEntered=hasValue(document.getElementById("demandP-"+i)?.value);
     if(monthIsConsidered(raw)||hasSavingData||demandPrincipalEntered)account.months[MONTHS[monthIndex][0]]=raw;else if(account.months[MONTHS[monthIndex][0]])delete account.months[MONTHS[monthIndex][0]];
     writeDb();
     if(window.firebaseCloud && window.firebaseCloud.saveCloudDb && window.firebaseCloud.currentUser){
       try{
         await window.firebaseCloud.saveCloudDb(db,activeMode);
       }catch(err){
         console.error("Row cloud sync failed:",err);
         document.getElementById("saveStatus").textContent="Wait Data Saving...";
         alert(describeCloudSaveError(err));
         return;
       }
     }
     markClean();document.getElementById("saveStatus").textContent="Saved "+name+" – "+MONTHS[monthIndex][0];
    };


    async function saveAll(){
      const v=vo();
      if(!v)return;

      /* First capture whatever is currently being edited on screen.
       * saveCurrentScreen() is async because it also synchronizes to Firestore.
       * It MUST be awaited here; otherwise Save All continues while the first
       * cloud write is still running, causing races and misleading failures. */
      if(!(await saveCurrentScreen()))return;

      ensureIndividualLoanInterestRates(v);
      const rateInput=document.getElementById("shgRateInput");
      const selectedKey=selectedLoanType||defaultLoanTypeKey();
      const rate=rateInput?Number(rateInput.value):Number(v.loanInterestRates[selectedKey]||12);
      if(!Number.isFinite(rate)||rate<0||rate>100){
        alert("Enter a valid interest rate between 0 and 100%.");
        if(rateInput)rateInput.focus();
        return;
      }
      v.loanInterestRates[selectedKey]=rate;
      v.interestRate=rate;

      /*
       * Persist/refresh every already-entered month for every SHG.
       * Months are stored independently, while May-27 onward derived
       * values are recalculated from the previous month's saved data.
       * This makes Save All SHGs an actual all-month save operation.
       */
      ensureLoanData(v);
      const allEntries=v.shgs.flatMap(member=>loanTypesForMode().map(type=>({member,loan:member.loans[type.key],type})));
      allEntries.forEach(entry=>{
        const s=entry.member;
        const account=entry.loan;
        account.name=s.name;
        const accountRate=Number(v.loanInterestRates[entry.type.key] ?? account.interestRate ?? 12);
        account.interestRate=accountRate;
        if(!account.months)account.months={};

        /*
         * SAVE ALL SHGs = materialize the complete Apr-Mar sequence for
         * every SHG/loan account.  Each month's Current Month Principal is
         * authoritative if it already exists; otherwise it inherits the
         * immediately previous month's value.  Therefore changing any
         * month creates a new value from that month forward, and repeating
         * Save All never destroys the user's latest change.
         */
        let carriedDemandPrincipal=0;
        MONTHS.forEach((m,mi)=>{
          const key=m[0];
          const existing=account.months[key];
          const d={...blank(),...(existing||{})};
          const startIdx=Number.isInteger(account.startMonthIndex)?account.startMonthIndex:(Number.isInteger(s.startMonthIndex)?s.startMonthIndex:0);
          if(mi<startIdx)return;

          const creationMonth=(startIdx>0&&mi===startIdx);
          if(creationMonth){
            d.opening=0;
            d.prevPrincipal=0;
            d.prevInterest=0;
            d.demandPrincipal=0;
            d.principalCollection=0;
            d.interestCollection=0;
            carriedDemandPrincipal=0;
          }else{
            if(existing && hasValue(existing.demandPrincipal)){
              // Existing value is the user's latest value for this month.
              carriedDemandPrincipal=Number(existing.demandPrincipal)||0;
            }else{
              // No saved value yet: inherit the immediately previous month.
              d.demandPrincipal=carriedDemandPrincipal;
            }

            if(mi>0){
              const prev=lastConsideredMonth(account,mi);
              if(prev){
                const pc=calc(prev.data);
                d.opening=pc.totalLoanBalance;
                d.prevPrincipal=pc.balancePrincipal;
                d.prevInterest=pc.balanceInterest;
              }
            }
          }

          // Keep the carried value in sync with the final value written.
          carriedDemandPrincipal=Number(d.demandPrincipal)||0;
          d.demandInterest=monthlyInterest(d.opening,account.interestRate);
          account.months[key]=d;
        });
      });
      writeDb();
      if(window.firebaseCloud && window.firebaseCloud.saveCloudDb && window.firebaseCloud.currentUser){
        try{
          document.getElementById("saveStatus").textContent="Saving to cloud…";
          await window.firebaseCloud.saveCloudDb(db,activeMode);
        }catch(err){
          console.error("Save All cloud sync failed:",err);
          document.getElementById("saveStatus").textContent="Wait Data Saving...";
          alert(describeCloudSaveError(err));
          return;
        }
      }
      refreshVOSelect();
      markClean();
      document.getElementById("saveStatus").textContent="All data saved and synchronized";
      alert(`All ${modeConfig().childPlural}, all months, and all Current Month Principal values have been saved and synchronized.`);
    }

    function rekeyMonthsForFinancialYear(v, oldFinancialYear, newFinancialYear){
      if(!v || !Array.isArray(v.shgs) || oldFinancialYear===newFinancialYear)return;
      const oldMonths=buildMonths(oldFinancialYear);
      const newMonths=buildMonths(newFinancialYear);
      v.shgs.forEach(s=>{
        const rekey=(account)=>{
          const oldData=account.months||{},next={};
          oldMonths.forEach((oldMonth,i)=>{const data=oldData[oldMonth[0]];if(data)next[newMonths[i][0]]=data;});
          account.months=next;
        };
        ensureLoanData(v);loanTypesForMode().forEach(type=>rekey(s.loans[type.key]));
      });
    }

    function saveVO(){
      const v=vo();if(!v)return;
      const name=document.getElementById("voName").value.trim();
      const detailsFy=document.getElementById("detailsFinancialYear");
      const financialYear=detailsFy?String(detailsFy.value||"").trim():"";
      const village=document.getElementById("village").value.trim();
      const linkedVoNameEl=document.getElementById("linkedVoName");
      const linkedVoName=linkedVoNameEl?linkedVoNameEl.value.trim():"";
      const mandal=document.getElementById("mandal").value.trim();
      if(!name){alert(`${modeConfig().parent} Name is required.`);document.getElementById("voName").focus();return;}
      if(modeConfig().voNameRequired && !linkedVoName){alert("VO Name is required for SHG.");if(linkedVoNameEl)linkedVoNameEl.focus();return;}
      if(!FINANCIAL_YEARS.includes(financialYear)){alert("Financial Year is required.");if(detailsFy)detailsFy.focus();return;}
      if(modeConfig().villageRequired && !village){alert("Village is required.");document.getElementById("village").focus();return;}
      if(!mandal){alert("Mandal is required.");document.getElementById("mandal").focus();return;}
      const district=document.getElementById("district").value.trim();
      if(modeConfig().districtRequired && !district){alert(`District is required for ${modeConfig().parent}.`);document.getElementById("district").focus();return;}

      const oldFinancialYear=FINANCIAL_YEARS.includes(v.financialYear)?v.financialYear:"";
      v.name=name;
      v.voName=linkedVoName;
      v.financialYear=financialYear;
      v.village=village;
      v.mandal=mandal;
      v.district=district;

      if(oldFinancialYear && oldFinancialYear!==financialYear){
        rekeyMonthsForFinancialYear(v,oldFinancialYear,financialYear);
      }

      currentFinancialYear=financialYear;
      MONTHS=buildMonths(currentFinancialYear);
      saveAll();
    }

    function exportBackup(){
      const blob=new Blob([JSON.stringify(db,null,2)],{type:"application/json"}),
            u=URL.createObjectURL(blob),
            a=document.createElement("a");
      a.href=u;
      a.download=modeConfig().backupFilename;
      a.click();
      URL.revokeObjectURL(u);
    }

    /*
     * Restore Backup = REPLACE mode.
     * The current database is replaced by the selected backup.
     * A warning is shown first so the user can export the current VOs
     * or choose Merge Backup instead.
     */
    function importBackup(file){
      const r=new FileReader();
      r.onload=()=>{
        try{
          const x=JSON.parse(r.result);
          if(!x||!Array.isArray(x.vos))throw 0;

          const currentCount=Array.isArray(db.vos)?db.vos.length:0;
          const importedCount=x.vos.length;

          const proceed=confirm(
            "WARNING: Restore Backup will REPLACE your current VOs.\n\n"+
            "Current VOs: "+currentCount+"\n"+
            "VOs in this backup: "+importedCount+"\n\n"+
            "Your current VOs will be removed from the dashboard if you continue.\n\n"+
            "Before continuing, click Cancel to Download Backup first, OR use Merge Backup to keep the current VOs and add the backup VOs.\n\n"+
            "Press OK only if you want to REPLACE the current data."
          );

          if(!proceed)return;

          db=x;
          selectedVOId=null;
          monthIndex=0;
          writeDb();
          refresh();
          document.getElementById("voDetailsSection").classList.add("hidden");
          document.getElementById("dashboard").classList.add("hidden");
          // Import completed successfully; clear any previous screen-dirty state.
          // Selecting a VO after import should NOT trigger the unsaved-changes warning.
          markClean();
          document.getElementById("saveStatus").textContent="Backup imported";
          alert("Backup imported. Current VOs were replaced by the imported backup.");
        }catch(e){
          alert("Invalid backup file.");
        }
      };
      r.readAsText(file);
    }

    /*
     * Merge Backup = MERGE mode.
     * Existing VOs are kept. VOs from the backup are appended.
     * If an imported VO has an ID already present in the current database,
     * it is skipped to avoid creating duplicate copies of the same VO.
     */
    function importAllBackup(file){
      const r=new FileReader();
      r.onload=()=>{
        try{
          const x=JSON.parse(r.result);
          if(!x||!Array.isArray(x.vos))throw 0;

          const currentVos=Array.isArray(db.vos)?db.vos:[],
                importedVos=x.vos;

          const proceed=confirm(
            "Merge Backup will KEEP your current VOs and ADD the VOs from this backup.\n\n"+
            "Current VOs: "+currentVos.length+"\n"+
            "VOs in this backup: "+importedVos.length+"\n\n"+
            "No current VO will be deleted.\n"+
            "If a backup VO has the same VO ID as an existing VO, that backup VO will be skipped to avoid duplicates.\n\n"+
            "Continue with Merge Backup?"
          );

          if(!proceed)return;

          const existingIds=new Set(currentVos.map(v=>String(v.id||"")));
          const added=[];
          const skipped=[];

          importedVos.forEach(v=>{
            const id=String(v&&v.id||"");
            if(id && existingIds.has(id)){
              skipped.push(v);
              return;
            }

            const clone=JSON.parse(JSON.stringify(v||{}));
            if(!clone.id || existingIds.has(String(clone.id))){
              clone.id="VO-"+Date.now()+"-"+Math.random().toString(36).slice(2);
            }

            existingIds.add(String(clone.id));
            added.push(clone);
            currentVos.push(clone);
          });

          db.vos=currentVos;
          selectedVOId=null;
          monthIndex=0;
          writeDb();
          refresh();
          document.getElementById("voDetailsSection").classList.add("hidden");
          document.getElementById("dashboard").classList.add("hidden");
          // Merge Backup completed successfully; there are no unsaved screen edits.
          // This prevents the VO-selection handler from showing an irrelevant warning.
          markClean();
          document.getElementById("saveStatus").textContent="Merge Backup completed";

          let message="Merge Backup completed.\n\n"+
                      "Current VOs kept: "+(currentVos.length-added.length)+"\n"+
                      "New VOs added: "+added.length+"\n"+
                      "Duplicate VO IDs skipped: "+skipped.length+"\n"+
                      "Total VOs now available: "+db.vos.length;

          if(skipped.length){
            message+="\n\nThe skipped VOs already existed with the same VO ID.";
          }

          alert(message);
        }catch(e){
          alert("Invalid backup file.");
        }
      };
      r.readAsText(file);
    }

    function resetAll(){
      const v=vo();
      if(!v){
        alert(`Please select a ${modeConfig().parent} first.`);
        return;
      }

      if(prompt(`Type DELETE to delete the currently selected ${modeConfig().parent}.`)==="DELETE"){
        db.vos=db.vos.filter(x=>x.id!==selectedVOId);
        selectedVOId=null;
        monthIndex=0;
        writeDb();

        // Deleting the selected VO returns the user to the Home / initial page.
        // Restore all Home-only UI here, just like goHome().
        document.getElementById("voDetailsSection").classList.add("hidden");
        const homeNewVoBtn=document.getElementById("homeNewVoBtn");
        if(homeNewVoBtn)homeNewVoBtn.style.removeProperty("display");
        document.getElementById("dataManagementSection").classList.remove("hidden");
        document.getElementById("dashboard").classList.add("hidden");
        document.getElementById("newVoForm").classList.add("hidden");
        document.getElementById("newVoName").value="";
        document.getElementById("saveStatus").textContent="";
        markClean();
        refresh();

        alert(`Current ${modeConfig().parent} deleted. Other ${modeConfig().parentPlural} are unchanged.`);
      }
    }


    function pdfFinancialYear(v){
      return v && FINANCIAL_YEARS.includes(v.financialYear) ? v.financialYear : "";
    }

    function ensurePdfFinancialYear(v){
      if(!pdfFinancialYear(v)){
        alert("Please select and save a Financial Year under Details before generating PDFs.");
        return false;
      }
      return true;
    }

    function pdfParentLabel(){return modeConfig().parent;}
    function pdfChildLabel(){return modeConfig().child;}
    function pdfChildNameLabel(){
      return currentMode==="SHG" ? "సభ్యురాలి" : pdfChildLabel();
    }
    function loanTypeDisplayLabel(key){
      if(key==="ALL")return "ALL Loans";
      const loanKey=String(key||"");
      const teluguMap={
        bankLinkage:"బ్యాంక్‌ లింకేజి అప్పు",
        streeNidhi:"స్త్రీ నిధి అప్పు",
        voCif:"VO CIF అప్పు",
        internalLoan:"అంతర్గత అప్పు",
        cif:"VO CIF అప్పు",
        sgsy:"SGSY అప్పు",
        pmfme:"PMFME అప్పు",
        nutrition:"Nutrition అప్పు",
        education:"Education అప్పు"
      };
      if(teluguMap[loanKey])return teluguMap[loanKey];
      const label=loanLabel(key);
      return String(label||key||"").replace(/^\s*\d+\.\s*/g,"").trim();
    }
    function pdfActiveLoanTypeKey(){
      const candidate=reportPreviewActive ? reportPreviewLoanType : (selectedLoanType||defaultLoanTypeKey());
      return candidate||defaultLoanTypeKey();
    }
    function pdfLoanTypeHeaderLabel(key=null){
      return loanTypeDisplayLabel(key||pdfActiveLoanTypeKey());
    }
    function pdfDcbTopHeaderText(loanKey=null){
      const loan=pdfLoanTypeHeaderLabel(loanKey);
      if(currentMode==="SHG")return `సభ్యురాలి వారీగా- ${esc(loan)} - DCB వివరాలు`;
      if(currentMode==="VO")return `SHG వారీగా- ${esc(loan)} - DCB వివరాలు`;
      return `VO వారీగా- ${esc(loan)} - DCB వివరాలు`;
    }
    function pdfLedgerTopHeaderText(v,entry){
      /* LL uses one single title line with explicit system labels.
         SHG also includes the linked VO name in the same line. */
      const loan=pdfLoanTypeHeaderLabel(entry?.loanKey||defaultLoanTypeKey());
      const parentName=String(v?.name||"").trim();
      let subject="";
      if(currentMode==="SHG"){
        const voName=String(v?.voName||document.getElementById("linkedVoName")?.value||"").trim();
        subject=`SHG : ${parentName}`;
        if(voName)subject+=`, VO : ${voName}`;
      }else if(currentMode==="MS"){
        subject=`MS : ${parentName}`;
      }else{
        subject=`VO : ${parentName}`;
      }
      return `${esc(subject)}, ${esc(loan)} - అప్పులెడ్జర్ ${esc(pdfFinancialYear(v))}`;
    }
    function pdfLocationLabelTelugu(){return modeConfig().pdf.ledgerFields[0].label;}
    function pdfLocationValue(v){return v[modeConfig().pdf.ledgerFields[0].field]||"";}
    function pdfHeaderLocationText(v){
      const c=modeConfig();
      if(currentMode==="SHG"){
        const shgName=esc(v.name||"");
        const voName=esc(v.voName||document.getElementById("linkedVoName")?.value||"");
        const village=esc(v.village||"");
        const mandal=esc(v.mandal||"");
        return `SHG : ${shgName},&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;VO : ${voName},&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;గ్రామం : ${village},&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;మండలం : ${mandal}`;
      }
      return `${pdfParentLabel()} : ${esc(v.name||"")},&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;${c.pdf.headerFields.map(item=>`${item.label} : ${esc(v[item.field]||"")}`).join(",&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;")}`;
    }

    function pdfLedgerLocationMeta(v){
      return modeConfig().pdf.ledgerFields.map(item=>`
        <div class="meta-key telugu">${item.label} :</div>
        <div class="meta-value telugu">${esc(v[item.field]||"")}</div>
      `).join("");
    }

    /*
     * UNIVERSAL PDF TABLE FITTING ENGINE
     * ----------------------------------
     * One fitting algorithm is used by EVERY PDF table in this file.
     *
     * Rules:
     * 1. Start every column at equal width.
     * 2. Measure the real rendered text using the loaded PDF font.
     * 3. Give long columns more width and take spare width from columns that
     *    genuinely have room to give.
     * 4. Never wrap, truncate, clip, hide or omit data.
     * 5. Never assign a different font size to individual cells.
     * DCB / Cumulative DCB exact fallback:
     * 1. 10 mm left/right + all data 13pt.
     * 2. If insufficient, 8 mm left/right + all data 13pt.
     * 3. If still insufficient, Child Name only becomes 10pt.
     * 4. If still insufficient, only the SHG Name row/cell that needs it wraps.
     * S.No is fixed and never donates space. All other columns donate spare
     * available width before any fallback stage.
     *
     * DCB / Cumulative DCB row rules:
     * - Maximum 25 REAL data rows per page.
     * - No filler rows are inserted.
     * - Total is not counted as a data row.
     * - The actual number of rows on a page determines the data-row height so
     *   the table uses the available page height efficiently.
     */
    const FIXED_SN_WIDTH=24.000; // fixed compact S.N column for every PDF

    function fitAllPDFTablesInPrintWindow(w){
      try{
        const doc=w.document;
        const A4_WIDTH=841.89;
        const A4_HEIGHT=595.28;
        const PAGE_MARGIN=28.3465;
        const PAGE_AVAILABLE=A4_WIDTH-(PAGE_MARGIN*2); // fixed 10 mm safe area on all sides

        const COMMON_REDUCTION_START=13;
        const COMMON_MIN_FONT=13;
        const COMMON_FONT_STEP=.25;
        const EPS=.05;

        function cssNumber(value){
          const n=parseFloat(value);
          return Number.isFinite(n)?n:0;
        }

        function ptFromPx(px){
          return px*72/96;
        }

        function pxFromPt(pt){
          return pt*96/72;
        }

        function clean(value){
          return String(value==null?"":value)
            .replace(/\u00a0/g," ")
            .replace(/\s+/g," ")
            .trim();
        }

        function paddingPt(el){
          const cs=w.getComputedStyle(el);
          return cssNumber(cs.paddingLeft)+cssNumber(cs.paddingRight);
        }

        function borderPt(el){
          const cs=w.getComputedStyle(el);
          return cssNumber(cs.borderLeftWidth)+cssNumber(cs.borderRightWidth);
        }

        function cellFontSizePt(el){
          const n=cssNumber(w.getComputedStyle(el).fontSize);
          return n>0?n:13;
        }

        /* Real DOM ruler: same browser/font metrics as the print document. */
        const ruler=doc.createElement("span");
        ruler.style.position="absolute";
        ruler.style.left="-100000px";
        ruler.style.top="-100000px";
        ruler.style.visibility="hidden";
        ruler.style.display="block";
        ruler.style.whiteSpace="nowrap";
        ruler.style.width="max-content";
        ruler.style.height="auto";
        ruler.style.padding="0";
        ruler.style.margin="0";
        ruler.style.border="0";
        ruler.style.lineHeight="1";
        ruler.style.boxSizing="content-box";
        doc.body.appendChild(ruler);

        function measureTextPt(reference,value,sizePt){
          const text=String(value==null?"":value);
          if(!text)return 0;

          const cs=w.getComputedStyle(reference);
          ruler.style.fontFamily=cs.fontFamily;
          ruler.style.fontWeight=cs.fontWeight;
          ruler.style.fontStyle=cs.fontStyle;
          ruler.style.fontStretch=cs.fontStretch;
          ruler.style.fontVariant=cs.fontVariant;
          ruler.style.letterSpacing=cs.letterSpacing;
          ruler.style.textTransform=cs.textTransform;
          ruler.style.fontSize=sizePt+"pt";
          ruler.textContent=text;

          return ptFromPx(ruler.getBoundingClientRect().width);
        }

        function dataRows(table){
          return Array.from(table.querySelectorAll("tbody tr.data-row"));
        }

        function dataCells(table){
          const cells=dataRows(table).flatMap(tr=>
            Array.from(tr.children).filter(cell=>cell.tagName==="TD")
          );
          /* The final Total row is part of the same width/fit rules as data.
           * It is NOT a normal data row for pagination, but every Total cell
           * must participate in column sizing and final wrapping. */
          const total=table.querySelector("tbody tr.total");
          if(total){
            cells.push(...Array.from(total.children).filter(cell=>cell.tagName==="TD"));
          }
          return cells;
        }

        function columnCount(table){
          return table.querySelectorAll("colgroup col").length;
        }

        function resetTableTransform(table){
          table.style.removeProperty("transform");
          table.style.removeProperty("transform-origin");
          table.style.removeProperty("margin-left");
          table.style.removeProperty("margin-right");
          table.style.removeProperty("overflow");
        }

        function setCommonDataFont(table,size){
          table.querySelectorAll(
            "tbody tr.data-row td, tbody tr.data-row td .pdf-cell-text, "+
            "tbody tr.total td, tbody tr.total td .pdf-cell-text"
          ).forEach(el=>{
            el.style.setProperty("font-family",'"Gidugu", Arial, sans-serif',"important");
            el.style.setProperty("font-size",size+"pt","important");
            el.style.setProperty("font-weight","400","important");
            el.style.setProperty("font-style","normal","important");
            el.style.setProperty("font-synthesis","none","important");
            el.style.setProperty("white-space","nowrap","important");
            el.style.setProperty("overflow","visible","important");
            el.style.setProperty("text-overflow","clip","important");
            el.style.setProperty("line-height","1","important");
          });
        }

        function setWidths(table,widths){
          const cols=Array.from(table.querySelectorAll("colgroup col"));
          if(cols.length!==widths.length)return;

          cols.forEach((col,i)=>{
            col.style.width=Math.max(.1,widths[i]).toFixed(4)+"pt";
          });

          table.style.width=widths.reduce((a,b)=>a+b,0).toFixed(4)+"pt";
          table.style.maxWidth="none";
          table.style.tableLayout="fixed";
        }

        function availableWidthForTable(table){
          /* Prefer the actual print page width. This intentionally consumes the
             small page margins efficiently, as requested. */
          const page=table.closest(".page")||table.parentElement;
          if(page){
            const cs=w.getComputedStyle(page);
            const pageWidth=cssNumber(cs.width);
            if(pageWidth>0)return Math.min(PAGE_AVAILABLE,pageWidth-(PAGE_MARGIN*2));
          }
          return PAGE_AVAILABLE;
        }

        function headerMinimums(table,count,size){
          const mins=Array(count).fill(0);

          table.querySelectorAll("thead tr").forEach(tr=>{
            let col=0;

            Array.from(tr.children).forEach(cell=>{
              const span=cell.colSpan||1;

              if(span===1 && col<count){
                const raw=(cell.innerText||cell.textContent||"")
                  .replace(/\r/g,"");

                const lines=raw.split("\n")
                  .map(clean)
                  .filter(Boolean);

                const longest=lines.reduce(
                  (a,b)=>b.length>a.length?b:a,
                  ""
                );

                if(longest){
                  const headerSize=cellFontSizePt(cell);
                  mins[col]=Math.max(
                    mins[col],
                    measureTextPt(cell,longest,headerSize)+
                    paddingPt(cell)+borderPt(cell)+2
                  );
                }
              }

              col+=span;
            });
          });

          return mins;
        }

        function requiredByColumn(table,size){
          const count=columnCount(table);
          const required=Array(count).fill(0);

          /*
           * IMPORTANT:
           * Column width is driven by REAL DATA first.
           *
           * Header text is intentionally NOT treated as a hard minimum.
           * DCB headers are allowed to wrap, so header space can be surrendered
           * when a data column (especially SHG Name) needs more room.
           *
           * Column 1 (S.No) is handled separately by redistribute() and remains
           * fixed at FIXED_SN_WIDTH.
           */
          dataCells(table).forEach(td=>{
            const col=td.cellIndex;
            if(col<0 || col>=count || col===0)return;

            const text=(td.textContent||"").trim();
            required[col]=Math.max(
              required[col],
              measureTextPt(td,text,size)+
              paddingPt(td)+borderPt(td)+2
            );
          });

          /*
           * Do not add headerMinimums() here.
           * Headers can wrap and therefore are a SOFT requirement.
           * This lets unused width in header-heavy columns be transferred
           * to columns whose actual data needs more room.
           */
          return required;
        }

        /*
         * SMART SPACE REDISTRIBUTION
         * -------------------------
         * 1. S.No (column 1) is permanently fixed and never donates space.
         * 2. Every other column starts from an equal share of the usable width.
         * 3. A column needing more than its equal share gets a DEFICIT.
         * 4. EVERY other column with width above its REAL DATA requirement is a
         *    donor. Donors give up their surplus proportionally.
         * 5. Header width is NOT a protected floor because DCB headers may wrap.
         * 6. If total real-data requirements fit inside the page, all data gets
         *    its required width and any remaining space is distributed normally.
         * 7. If total real-data requirements exceed the page, every donor is
         *    reduced as far as its own data requirement allows; the remaining
         *    unavoidable shortage is shared among the needy columns.
         *
         * This means a long SHG name can take space from columns 3,4,5,...17
         * wherever those columns have genuine spare data capacity. It is not
         * limited to a pre-selected donor column.
         */
        function redistribute(required,available){
          const count=required.length;
          if(!count)return [];

          const slNoIndex=0;
          const slNoWidth=Math.min(FIXED_SN_WIDTH,Math.max(.1,available));

          if(count===1)return [slNoWidth];

          const remaining=Math.max(.1,available-slNoWidth);
          const n=count-1;
          const equal=remaining/n;

          let widths=Array(count).fill(equal);
          widths[slNoIndex]=slNoWidth;

          const req=required.slice(1).map(r=>Math.max(.1,r));

          /*
           * First pass: start from equal columns and calculate who needs
           * additional space and who can donate it.
           */
          let need=req.map((r,i)=>Math.max(0,r-equal));
          let spare=Array(n).fill(0).map((_,i)=>Math.max(0,equal-req[i]));

          let totalNeed=need.reduce((a,b)=>a+b,0);
          let totalSpare=spare.reduce((a,b)=>a+b,0);

          if(totalNeed>EPS && totalSpare>EPS){
            const transfer=Math.min(totalNeed,totalSpare);

            /*
             * Take space from ALL donor columns, proportional to each donor's
             * available surplus, and give it to ALL needy columns, proportional
             * to each needy column's deficit.
             */
            for(let i=0;i<n;i++){
              if(totalNeed>EPS && need[i]>0)
                widths[i+1]+=transfer*(need[i]/totalNeed);
            }

            for(let i=0;i<n;i++){
              if(totalSpare>EPS && spare[i]>0)
                widths[i+1]-=transfer*(spare[i]/totalSpare);
            }
          }

          /*
           * If the first transfer was not enough, force every donor down to
           * its REAL DATA requirement. Headers are allowed to wrap and therefore
           * do not block this transfer.
           */
          let used=widths.reduce((a,b)=>a+b,0);
          let shortage=0;

          for(let i=0;i<n;i++){
            if(widths[i+1] < req[i]-EPS){
              shortage += req[i]-widths[i+1];
            }
          }

          if(shortage>EPS){
            let donorSpace=0;
            for(let i=0;i<n;i++){
              donorSpace += Math.max(0,widths[i+1]-req[i]);
            }

            if(donorSpace>EPS){
              for(let i=0;i<n;i++){
                const donor=Math.max(0,widths[i+1]-req[i]);
                if(donor>0)
                  widths[i+1]-=Math.min(donor,donorSpace*shortage/donorSpace);
              }
            }

            /*
             * Rebuild the final allocation from data requirements if possible.
             * This guarantees the complete table still occupies exactly the
             * A4 safe width while never taking anything from S.No.
             */
            const reqSum=req.reduce((a,b)=>a+b,0);

            if(reqSum<=remaining+EPS){
              for(let i=0;i<n;i++) widths[i+1]=req[i];

              let leftover=remaining-reqSum;

              /*
               * Give leftover back to the non-S.No columns. Columns with
               * longer data receive a little more room, while all columns
               * remain within the same total page width.
               */
              const weights=req.map(r=>Math.max(1,r));
              const weightSum=weights.reduce((a,b)=>a+b,0);

              for(let i=0;i<n;i++){
                widths[i+1]+=leftover*(weights[i]/weightSum);
              }
            }else{
              /*
               * Genuine page-width shortage: keep 13pt data and use the entire
               * available width. The unavoidable deficit is shared among all
               * columns according to their required width. S.No remains fixed.
               */
              const scale=remaining/reqSum;
              for(let i=0;i<n;i++){
                widths[i+1]=Math.max(.1,req[i]*scale);
              }
            }
          }

          /*
           * Final normalization applies ONLY to columns 2 onward.
           * Column 1 remains exactly FIXED_SN_WIDTH.
           */
          const otherSum=widths.slice(1).reduce((a,b)=>a+b,0);
          if(otherSum>0){
            const scale=remaining/otherSum;
            for(let i=1;i<count;i++) widths[i]*=scale;
          }

          widths[slNoIndex]=slNoWidth;
          return widths;
        }

        function allDataCellsFit(table,widths,size){
          let fits=true;

          dataCells(table).forEach(td=>{
            const col=td.cellIndex;
            if(col<0 || col>=widths.length)return;

            const available=Math.max(
              0,
              widths[col]-paddingPt(td)-borderPt(td)-2
            );

            if(measureTextPt(td,td.textContent||"",size)>available+EPS){
              fits=false;
            }
          });

          return fits;
        }

        function setDcbRowHeight(table){
          const page=table.closest(".dcb-page,.cumulative-dcb-page");
          if(!page)return;

          const rows=dataRows(table);
          if(!rows.length)return;

          const total=table.querySelector("tbody tr.total");
          const pageHeight=A4_HEIGHT;
          const pageCS=w.getComputedStyle(page);
          const pagePaddingTop=cssNumber(pageCS.paddingTop);
          const pagePaddingBottom=cssNumber(pageCS.paddingBottom);

          const blank=page.querySelector(".dcb-top-blank");
          const head=page.querySelector(".dcb-head,.cumulative-dcb-head");
          const reportTypeRow=page.querySelector(".dcb-report-type-full-row,.cumulative-dcb-report-type-full-row");

          const blankH=blank ? blank.getBoundingClientRect().height*72/96 : 0;
          const reportTypeH=reportTypeRow ? reportTypeRow.getBoundingClientRect().height*72/96 : 0;
          const headH=head ? head.getBoundingClientRect().height*72/96 : 0;
          const thead=table.tHead;
          const theadH=thead ? thead.getBoundingClientRect().height*72/96 : 0;
          const totalH=total ? total.getBoundingClientRect().height*72/96 : 0;

          const safety=2;
          const usable=Math.max(
            1,
            pageHeight-
            pagePaddingTop-
            pagePaddingBottom-
            blankH-
            reportTypeH-
            headH-
            theadH-
            totalH-
            safety
          );

          const FIXED_DCB_ROW_HEIGHT=20;

          /*
           * Normal rows remain 20pt. A row containing a wrapped SHG Name gets
           * the height actually required by that cell, so wrapping is a real
           * last-resort option rather than clipped text.
           */
          const requested=rows.map(row=>{
            let h=FIXED_DCB_ROW_HEIGHT;

            if(row.dataset.shgWrapped==="true" || row.dataset.finalWrapped==="true"){
              Array.from(row.children).forEach(td=>{
                if(td.dataset.wrapShg!=="true" && td.dataset.wrapFinal!=="true")return;

                const measured=td.getBoundingClientRect().height*72/96;
                h=Math.max(h,measured+2);
              });
            }

            return Math.max(12,h);
          });

          const requestedSum=requested.reduce((a,b)=>a+b,0);

          /*
           * If wrapped rows make 25 rows too tall, compress the row heights
           * proportionally, but never below 12pt. The SHG text remains wrapped
           * and at 10pt; it is never hidden.
           */
          let scale=1;
          if(requestedSum>usable){
            scale=Math.max(
              12/FIXED_DCB_ROW_HEIGHT,
              usable/requestedSum
            );
          }

          rows.forEach((row,i)=>{
            const h=Math.max(12,requested[i]*scale);

            row.style.height=h.toFixed(3)+"pt";
            row.style.minHeight=h.toFixed(3)+"pt";
            row.style.maxHeight=h.toFixed(3)+"pt";
            row.style.breakInside="avoid";
            row.style.pageBreakInside="avoid";

            Array.from(row.children).forEach(td=>{
              td.style.height=h.toFixed(3)+"pt";
              td.style.minHeight=h.toFixed(3)+"pt";
              td.style.maxHeight=h.toFixed(3)+"pt";
            });
          });
        }

        function fitOneTable(table){
          const count=columnCount(table);
          if(!count)return;

          const isDcb=table.matches(".dcb-table,.cumulative-dcb-table");
          const isLedger=table.matches(".ledger-table");
          const page=table.closest(".dcb-page,.cumulative-dcb-page,.ledger-page");

          const M10=28.3465; // 10 mm
          const M8=22.6772;  // 8 mm
          const W10=A4_WIDTH-(M10*2);
          const W8=A4_WIDTH-(M8*2);
          const SHG_COL=1;   // S.No=0, SHG Name=1

          /*
           * EXACT FALLBACK ORDER
           * --------------------
           * DCB + Cumulative DCB:
           *   1) 10 mm left/right + every DATA cell 13pt
           *   2) only if stage 1 cannot fit -> 8 mm left/right + every DATA cell 13pt
           *   3) only if stage 2 cannot fit -> SHG NAME ONLY becomes 10pt
           *   4) only if stage 3 cannot fit -> wrap ONLY the SHG NAME cell(s)
           *      whose own text still does not fit.
           *
           * S.No is permanently fixed and never donates space.
           * All columns except S.No may donate their spare width before any
           * fallback stage is triggered.
           *
           * Loan Ledger has no SHG-name DATA column. It therefore uses stages
           * 1 and 2 only, while all Ledger data remains 13pt.
           */

          function setStage(marginPt,widthPt){
            if(page){
              page.style.setProperty(
                "padding-left",`${marginPt.toFixed(4)}pt`,"important"
              );
              page.style.setProperty(
                "padding-right",`${marginPt.toFixed(4)}pt`,"important"
              );
            }

            const frame=page ? page.querySelector(
              isLedger ? ".ledger-frame" :
              (table.classList.contains("cumulative-dcb-table")
                ? ".cumulative-dcb-frame"
                : ".dcb-frame")
            ) : null;

            if(frame){
              frame.style.setProperty("width",`${widthPt.toFixed(4)}pt`,"important");
              frame.style.setProperty("max-width",`${widthPt.toFixed(4)}pt`,"important");
              frame.style.setProperty("min-width",`${widthPt.toFixed(4)}pt`,"important");
              frame.style.marginLeft="0";
              frame.style.marginRight="0";
              frame.style.boxSizing="border-box";
            }

            /* LOAN LEDGER ONLY:
             * The browser's collapsed-border rendering needs a small
             * sub-point correction so the final table edge lands exactly on
             * the .ledger-frame right border.
             *
             * 10 mm stage: 785.197pt frame -> 784.500pt Ledger table.
             * DCB and Cumulative DCB are completely unchanged.
             */
            const tableWidthPt = isLedger
              ? Math.max(0.1, widthPt - 0.697)
              : widthPt;
            table.style.setProperty("width",`${tableWidthPt.toFixed(4)}pt`,"important");
            table.style.setProperty("max-width",`${tableWidthPt.toFixed(4)}pt`,"important");
            table.style.setProperty("min-width",`${tableWidthPt.toFixed(4)}pt`,"important");
            table.style.marginLeft="0";
            table.style.marginRight="0";
            table.style.boxSizing="border-box";
            table.dataset.pdfWidthPt=String(widthPt);
            table.dataset.pdfMarginPt=String(marginPt);
          }

          function clearDcbFallbackStyles(){
            if(!isDcb)return;

            table.querySelectorAll("tbody td").forEach(td=>{
              td.dataset.wrapShg="false";
              td.dataset.wrapFinal="false";
              td.dataset.shgFont10="false";
              td.style.removeProperty("font-size");
              td.style.removeProperty("font-family");
              td.style.removeProperty("font-weight");
              td.style.removeProperty("font-style");
              td.style.removeProperty("font-synthesis");
              td.style.removeProperty("line-height");
              td.style.removeProperty("white-space");
              td.style.removeProperty("overflow");
              td.style.removeProperty("overflow-wrap");
              td.style.removeProperty("word-break");
              td.style.removeProperty("text-overflow");
              td.classList.remove("pdf-final-wrap");
            });

            table.querySelectorAll("tbody tr").forEach(row=>{
              row.dataset.shgWrapped="false";
              row.dataset.finalWrapped="false";
            });
          }

          /*
           * DCB FONT RULE:
           * The SHG Name column does NOT become 10pt as a whole.
           * Only the individual SHG Name cells explicitly marked
           * data-shg-font10="true" use 10pt. Every other SHG Name cell,
           * and every other DATA cell, remains 13pt.
           */
          function setDcbFonts(){
            table.querySelectorAll(
              "tbody tr.data-row td, tbody tr.data-row td .pdf-cell-text, "+
              "tbody tr.total td, tbody tr.total td .pdf-cell-text"
            ).forEach(el=>{
              const td=el.closest("td");
              const isShg=td && td.cellIndex===SHG_COL;
              const size=(isShg && td.dataset.shgFont10==="true") ? 10 : 13;

              el.style.setProperty(
                "font-family",'"Gidugu",Arial,sans-serif',"important"
              );
              el.style.setProperty("font-size",`${size}pt`,"important");
              el.style.setProperty("font-weight","400","important");
              el.style.setProperty("font-style","normal","important");
              el.style.setProperty("font-synthesis","none","important");
              el.style.setProperty("line-height","1","important");

              if(td && (td.dataset.wrapShg==="true" || td.dataset.wrapFinal==="true")){
                el.style.setProperty("white-space","normal","important");
                el.style.setProperty("overflow-wrap","anywhere","important");
                el.style.setProperty("word-break","break-word","important");
                el.style.setProperty("overflow","hidden","important");
              }else{
                el.style.setProperty("white-space","nowrap","important");
                el.style.setProperty("overflow","visible","important");
                el.style.setProperty("overflow-wrap","normal","important");
                el.style.setProperty("word-break","normal","important");
              }
            });
          }

          function requiredDcb(){
            const req=Array(count).fill(0);
            const hasData=Array(count).fill(false);

            /* A column containing only numeric zeroes is treated as having no
             * meaningful entered data for HEADER-MINIMUM purposes. This keeps
             * headers such as "కొత్త అప్పు" visible even when every row is 0.
             * The zero values themselves still participate in normal data sizing. */
            const hasMeaningfulData=value=>{
              const t=String(value==null?"":value).trim();
              if(!t)return false;
              const compact=t.replace(/[\s,]/g,"");
              return !/^[-+]?0(?:\.0+)?$/.test(compact);
            };

            dataCells(table).forEach(td=>{
              const col=td.cellIndex;
              if(col<=0 || col>=count)return;
              const text=(td.textContent||"").trim();
              if(hasMeaningfulData(text))hasData[col]=true;
              if(td.dataset.wrapFinal==="true")return;

              const cellSize=(
                col===SHG_COL && td.dataset.shgFont10==="true"
              ) ? 10 : 13;

              if(text){
                req[col]=Math.max(
                  req[col],
                  measureTextPt(td,text,cellSize)+paddingPt(td)+borderPt(td)+2
                );
              }
            });

            /*
             * Header is a SOFT requirement when a column contains data.
             * However, if a column has no data at all, its header must remain
             * visible, so that header text establishes the minimum width.
             */
            table.querySelectorAll("thead tr").forEach(tr=>{
              let col=0;
              Array.from(tr.children).forEach(cell=>{
                const span=cell.colSpan||1;
                if(span===1 && col<count && col!==0 && !hasData[col]){
                  const raw=(cell.innerText||cell.textContent||"").replace(/\r/g,"");
                  const lines=raw.split("\n").map(clean).filter(Boolean);
                  const longest=lines.reduce((a,b)=>b.length>a.length?b:a,"");
                  if(longest){
                    const headerSize=cellFontSizePt(cell);
                    req[col]=Math.max(
                      req[col],
                      measureTextPt(cell,longest,headerSize)+paddingPt(cell)+borderPt(cell)+2
                    );
                  }
                }
                col+=span;
              });
            });

            return req;
          }

          function fitsDcb(widths,size){
            let fits=true;
            dataCells(table).forEach(td=>{
              const col=td.cellIndex;
              if(col<0 || col>=widths.length || col===0)return;
              if(td.dataset.wrapFinal==="true")return;

              const actualSize=(
                col===SHG_COL && td.dataset.shgFont10==="true"
              ) ? 10 : 13;
              const room=Math.max(0,widths[col]-paddingPt(td)-borderPt(td)-2);
              if(measureTextPt(td,td.textContent||"",actualSize)>room+EPS)fits=false;
            });
            return fits;
          }

          /*
           * Apply a width allocation while NEVER touching S.No.
           * redistribute() starts all non-S.No columns equally, then transfers
           * space from every genuine donor to every needy column. If total
           * required width is physically larger than the page, only then does
           * it compress the non-S.No columns proportionally.
           */
          function applyWidths(marginPt,widthPt){
            setStage(marginPt,widthPt);

            const required=requiredDcb();
            const widths=redistribute(required,widthPt);

            setWidths(table,widths);
            void table.offsetWidth;

            return {required,widths};
          }

          resetTableTransform(table);

          if(isDcb){
            clearDcbFallbackStyles();

            /* =============================================================
             * STAGE 1
             * 10 mm left + right, ALL DATA at 13pt.
             * =========================================================== */
            setDcbFonts();
            let result=applyWidths(M10,W10);

            if(fitsDcb(result.widths,13)){
              setDcbRowHeight(table);
              return;
            }

            /* =============================================================
             * STAGE 2
             * ONLY NOW reduce left + right margins to 8 mm.
             * ALL DATA remains 13pt.
             * =========================================================== */
            setDcbFonts();
            result=applyWidths(M8,W8);

            if(fitsDcb(result.widths,13)){
              setDcbRowHeight(table);
              return;
            }

            /* =============================================================
             * STAGE 3
             * ONLY THE INDIVIDUAL SHG NAME CELL(S) THAT NEED IT become 10pt.
             *
             * The entire SHG Name column NEVER changes to 10pt.
             * SHG cells that fit at 13pt stay at 13pt.
             * =========================================================== */
            dataCells(table).forEach(td=>{
              if(td.cellIndex!==SHG_COL)return;

              const room=Math.max(
                0,
                result.widths[SHG_COL]-paddingPt(td)-borderPt(td)-2
              );

              if(measureTextPt(td,td.textContent||"",13)>room+EPS){
                td.dataset.shgFont10="true";
              }
            });

            setDcbFonts();
            result=applyWidths(M8,W8);

            /*
             * Re-check after the mixed 13pt/10pt allocation. If moving
             * space between columns makes another SHG cell become the
             * limiting cell, reduce ONLY that particular cell to 10pt.
             */
            let changed=true;
            let guard=0;
            while(changed && guard++<count){
              changed=false;

              result.widths && dataCells(table).forEach(td=>{
                if(td.cellIndex!==SHG_COL)return;
                if(td.dataset.wrapShg==="true")return;

                const size=(td.dataset.shgFont10==="true")?10:13;
                const room=Math.max(
                  0,
                  result.widths[SHG_COL]-paddingPt(td)-borderPt(td)-2
                );

                if(size===13 &&
                   measureTextPt(td,td.textContent||"",13)>room+EPS){
                  td.dataset.shgFont10="true";
                  changed=true;
                }
              });

              if(changed){
                setDcbFonts();
                result=applyWidths(M8,W8);
              }
            }

            if(fitsDcb(result.widths,13)){
              setDcbRowHeight(table);
              return;
            }

            /*
             * At this point only SHG cells marked above may use 10pt.
             * All other data remains 13pt.
             */
            if(fitsDcb(result.widths,10)){
              setDcbRowHeight(table);
              return;
            }

            /* =============================================================
             * STAGE 4
             * FINAL LEVEL: if a data cell OR Total-row cell still cannot fit,
             * wrap ONLY THAT PARTICULAR CELL. S.No is never wrapped. All other
             * columns remain 13pt; SHG cells already selected for 10pt remain 10pt.
             * ============================================================= */
            dataCells(table).forEach(td=>{
              const col=td.cellIndex;
              if(col<=0 || col>=count)return;
              if(td.dataset.wrapFinal==="true")return;

              const size=(col===SHG_COL && td.dataset.shgFont10==="true")?10:13;
              const room=Math.max(0,result.widths[col]-paddingPt(td)-borderPt(td)-2);
              if(measureTextPt(td,td.textContent||"",size)>room+EPS){
                td.dataset.wrapFinal="true";
                td.classList.add("pdf-final-wrap");
                const row=td.closest("tr");
                if(row)row.dataset.finalWrapped="true";
              }
            });

            setDcbFonts();
            setDcbRowHeight(table);
            return;
          }

          if(isLedger){
            /*
             * Loan Ledger: exact same first two margin stages, 13pt data.
             * There is no SHG Name data column inside the ledger table, so
             * stages 3/4 are not applicable.
             */
            setCommonDataFont(table,13);

            setStage(M10,W10);
            let required=requiredByColumn(table,13);
            /* W10 is the frame's outer width. The table is inside the frame,
             * so reserve its 1px left + 1px right borders. */
            let widths=redistribute(required,Math.max(0.1,W10-2));
            setWidths(table,widths);
            void table.offsetWidth;

            if(allDataCellsFit(table,widths,13)){
              return;
            }

            /* ONLY if 10 mm fails -> 8 mm. */
            setStage(M8,W8);
            setCommonDataFont(table,13);
            required=requiredByColumn(table,13);
            /* Same frame-content-width correction for the 8 mm fallback. */
            widths=redistribute(required,Math.max(0.1,W8-2));
            setWidths(table,widths);
            void table.offsetWidth;

            /* Never reduce Ledger data below 13pt. If still insufficient,
             * wrap only the individual overflowing data cells; S.No remains
             * fixed and is never wrapped. */
            setCommonDataFont(table,13);
            dataCells(table).forEach(td=>{
              const col=td.cellIndex;
              if(col<=0 || col>=widths.length)return;
              const room=Math.max(0,widths[col]-paddingPt(td)-borderPt(td)-2);
              if(measureTextPt(td,td.textContent||"",13)>room+EPS){
                td.classList.add("pdf-final-wrap");
              }
            });
            return;
          }

          /*
           * Any future non-PDF table is left on the existing common fitting
           * path, but PDF tables above use the exact requested fallback order.
           */
          const available=availableWidthForTable(table);
          setCommonDataFont(table,13);
          let required=requiredByColumn(table,13);
          let widths=redistribute(required,available);
          setWidths(table,widths);
          void table.offsetWidth;
        }

        doc.querySelectorAll(
          ".ledger-table, .dcb-table, .cumulative-dcb-table"
        ).forEach(fitOneTable);

        ruler.remove();
      }catch(e){
        try{ console.warn("PDF table fitting error:",e); }catch(ignore){}
      }
    }

    /*
     * DCB header/table alignment.
     * The final table transform and fitted column split are copied to the
     * matching DCB header so the header never remains wider than the table.
     */
    function syncDcbHeadersAfterFit(w){
  try{
    const doc = w.document;

    function sync(frame, table, head){

      if(!frame || !table || !head) return;

      const page =
        table.closest(".dcb-page,.cumulative-dcb-page");

      if(!page) return;

      const reportTypeRow =
        page.querySelector(
          ".dcb-report-type-full-row," +
          ".cumulative-dcb-report-type-full-row"
        );

      /*
       * IMPORTANT:
       * The TABLE is the source of truth.
       *
       * Do not use the nominal 785.197pt width here.
       * First let the browser finish rendering the fitted table,
       * then read its actual painted geometry.
       */
      void table.offsetWidth;

      const tableRect =
        table.getBoundingClientRect();

      const tableWidth =
        tableRect.width;

      if(!(tableWidth > 0)) return;


      /* =========================================================
       * 1. FORCE ALL OUTER ELEMENTS TO THE FINAL TABLE WIDTH
       * ========================================================= */

      [
        frame,
        table,
        head,
        reportTypeRow
      ].filter(Boolean).forEach(el => {

        el.style.setProperty(
          "width",
          `${tableWidth.toFixed(3)}px`,
          "important"
        );

        el.style.setProperty(
          "min-width",
          `${tableWidth.toFixed(3)}px`,
          "important"
        );

        el.style.setProperty(
          "max-width",
          `${tableWidth.toFixed(3)}px`,
          "important"
        );

        el.style.setProperty(
          "box-sizing",
          "border-box",
          "important"
        );

        el.style.marginLeft = "0";
        el.style.marginRight = "0";
      });


      /* =========================================================
       * 2. FIND THE REAL TABLE COLUMN SPLIT
       *
       * DCB:
       *   left  = columns 1-10
       *   right = columns 11-17
       *
       * Cumulative DCB:
       *   left  = columns 1-8
       *   right = columns 9-13
       * ========================================================= */

      const numberRow =
        table.querySelector(
          "thead tr.number-head"
        );

      const numberCells =
        numberRow
          ? Array.from(numberRow.children)
          : [];

      const leftSpan =
        parseInt(
          head.dataset.leftSpan || "0",
          10
        ) || 0;

      let leftWidth = 0;

      if(
        numberCells.length &&
        leftSpan > 0 &&
        numberCells[leftSpan - 1]
      ){

        const boundaryRect =
          numberCells[leftSpan - 1]
            .getBoundingClientRect();

        /*
         * This is the REAL painted position of
         * the table's column boundary.
         */
        leftWidth =
          boundaryRect.right -
          tableRect.left;
      }


      if(!(leftWidth > 0)){
        /*
         * Fallback: use the col widths.
         */
        const cols =
          Array.from(
            table.querySelectorAll(
              ":scope > colgroup > col"
            )
          );

        leftWidth =
          cols
            .slice(0, leftSpan)
            .reduce(
              (sum, col) =>
                sum + col.getBoundingClientRect().width,
              0
            );
      }


      leftWidth =
        Math.max(
          0.1,
          Math.min(
            leftWidth,
            tableWidth - 0.1
          )
        );


      const rightWidth =
        Math.max(
          0.1,
          tableWidth - leftWidth
        );


      /* =========================================================
       * 3. HEADER BORDER MUST NOT BE INCLUDED IN GRID TRACKS
       * ========================================================= */

      const headStyle =
        getComputedStyle(head);

      const borderLeft =
        parseFloat(
          headStyle.borderLeftWidth
        ) || 0;

      const borderRight =
        parseFloat(
          headStyle.borderRightWidth
        ) || 0;


      const gridContentWidth =
        Math.max(
          0.1,
          tableWidth -
          borderLeft -
          borderRight
        );


      /*
       * leftWidth is measured from the OUTER table edge.
       * Remove the header's left border before
       * assigning it as a grid track.
       */
      const firstTrack =
        Math.max(
          0.1,
          leftWidth - borderLeft
        );


      const secondTrack =
        Math.max(
          0.1,
          gridContentWidth - firstTrack
        );


      /* =========================================================
       * 4. APPLY EXACT GRID SPLIT
       * ========================================================= */

      head.style.setProperty(
        "display",
        "grid",
        "important"
      );

      head.style.setProperty(
        "grid-template-columns",
        `${firstTrack.toFixed(3)}px ` +
        `${secondTrack.toFixed(3)}px`,
        "important"
      );

      head.style.setProperty(
        "width",
        `${tableWidth.toFixed(3)}px`,
        "important"
      );

      head.style.setProperty(
        "min-width",
        `${tableWidth.toFixed(3)}px`,
        "important"
      );

      head.style.setProperty(
        "max-width",
        `${tableWidth.toFixed(3)}px`,
        "important"
      );


      /* =========================================================
       * 5. FORCE HEADER CHILDREN TO SAME TRACK WIDTH
       * ========================================================= */

      const children =
        Array.from(head.children);

      if(children[0]){
        children[0].style.setProperty(
          "width",
          `${firstTrack.toFixed(3)}px`,
          "important"
        );

        children[0].style.setProperty(
          "min-width",
          `${firstTrack.toFixed(3)}px`,
          "important"
        );

        children[0].style.setProperty(
          "max-width",
          `${firstTrack.toFixed(3)}px`,
          "important"
        );

        children[0].style.setProperty(
          "box-sizing",
          "border-box",
          "important"
        );
      }

      if(children[1]){
        children[1].style.setProperty(
          "width",
          `${secondTrack.toFixed(3)}px`,
          "important"
        );

        children[1].style.setProperty(
          "min-width",
          `${secondTrack.toFixed(3)}px`,
          "important"
        );

        children[1].style.setProperty(
          "max-width",
          `${secondTrack.toFixed(3)}px`,
          "important"
        );

        children[1].style.setProperty(
          "box-sizing",
          "border-box",
          "important"
        );
      }


      /*
       * Force final layout/repaint.
       */
      void head.offsetWidth;
      void frame.offsetWidth;

    }


    /* =========================================================
     * DCB
     * ========================================================= */

    doc.querySelectorAll(
      ".dcb-page"
    ).forEach(page => {

      sync(
        page.querySelector(".dcb-frame"),
        page.querySelector(".dcb-table"),
        page.querySelector(".dcb-head")
      );

    });


    /* =========================================================
     * CUMULATIVE DCB
     * ========================================================= */

    doc.querySelectorAll(
      ".cumulative-dcb-page"
    ).forEach(page => {

      sync(
        page.querySelector(
          ".cumulative-dcb-frame"
        ),
        page.querySelector(
          ".cumulative-dcb-table"
        ),
        page.querySelector(
          ".cumulative-dcb-head"
        )
      );

    });


  }catch(e){

    try{
      console.warn(
        "DCB header alignment error:",
        e
      );
    }catch(ignore){}

  }
}

    function printReport(title, body){
      const v=vo();
      const voNameForFile = v && v.name ? String(v.name).trim() : "VO";
      const safeVOName = voNameForFile.replace(/[\\/:*?"<>|]+/g,"_").replace(/\s+/g," ").trim() || "VO";
      // PDF filename is determined by the report title passed to printReport().
      // Report functions pass: DCB, LL, Cumulative-DCB, or VO.
      // Examples: Laxmi-VO-DCB.pdf, Laxmi-VO-LL.pdf,
      // Laxmi-VO-Cumulative-DCB.pdf, and Laxmi-VO.pdf.
      const reportSuffix = String(title || "VO")
        .replace(/^\s*VOName-VO(?:-|$)/i, "")
        .trim();
      const printTitle = safeVOName + "-VO" +
        (reportSuffix && !/^VO$/i.test(reportSuffix) ? "-" + reportSuffix : "");
      const w=window.open("","_blank");
      if(!w){
        alert("Allow pop-ups to print the PDF.");
        return;
      }

      w.document.write(`<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${printTitle}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Gidugu&display=swap" rel="stylesheet">
<style>
@page{
  size: A4 landscape;
  margin: 0;
}
/* IMPORTANT: the print window is a separate document, so the main-page
   box-sizing rule does not carry over. Without this, .page height plus
   its top padding becomes taller than A4 and the browser inserts an
   otherwise blank page between report pages. */
*,*::before,*::after{
  box-sizing:border-box;
}
html,body{
  margin:0!important;
  padding:0!important;
  background:#fff!important;
  color:#111;
  font-family:"Gidugu",Arial,sans-serif;
}
.page{
  width:841.89pt;
  height:595.28pt;
  position:relative;
  box-sizing:border-box;
  padding:28.3465pt;
  page-break-after:always;
  break-after:page;
  overflow:hidden;
}
.page:last-child{
  page-break-after:auto;
  break-after:auto;
}
.combined-blank-page{
  width:841.89pt;
  height:595.28pt;
  min-height:595.28pt;
  padding:0!important;
  margin:0!important;
  border:0!important;
  background:#fff!important;
  page-break-after:always;
  break-after:page;
  overflow:hidden;
}

/* MS PDF metadata order: MS -> Mandal -> District.
   VO PDF metadata order remains unchanged. */
/* ---------------- LOAN LEDGER ---------------- */
.ledger-page{
  padding:28.3465pt;
}
.ledger-frame{
  width:var(--ledger-width,785.197pt);
  margin-left:0;
  margin-right:0;
  border:1px solid #555;
}
.ledger-blank{
  height:22pt;
  border-bottom:1px solid #555;
}
.pdf-report-type-header{
  width:100%;
  min-height:24pt;
  height:24pt;
  display:flex;
  align-items:center;
  justify-content:center;
  text-align:center;
  box-sizing:border-box;
  border:1px solid #555;
  border-bottom:0;
  font-family:"Gidugu",Arial,sans-serif;
  font-size:15.5pt;
  font-weight:100;
  line-height:1;
  white-space:nowrap;
  overflow:hidden;
}
.ledger-report-type-header{
  display:none !important;
}
.ledger-title-row{
  height:34pt;
  border-top:1px solid #555;
  display:grid;
  grid-template-columns:1fr 55pt 50pt;
  border-bottom:1px solid #555;
  position:relative;
  overflow:hidden;
}
.ledger-title{
  display:flex;
  align-items:center;
  justify-content:center;
  gap:0;
  text-align:center;
  font-size:15.5pt;
  line-height:1;
  border-right:1px solid #555;
  white-space:nowrap;
  overflow:hidden;
  min-width:0;
}
.ledger-loan-title,.ledger-name-title{
  display:inline-block;
  white-space:nowrap;
  flex:0 1 auto;
  min-width:0;
  overflow:hidden;
  text-overflow:clip;
}
.ledger-title-separator{
  display:inline-block;
  flex:0 0 auto;
  font-weight:700;
}
.page-label{
  display:flex;
  align-items:center;
  justify-content:center;
  text-align:center;
  font-family:Arial,sans-serif;
  font-size:8pt;
  font-weight:700;
  border-right:0!important;
  position:relative;
}
.page-number{
  display:flex;
  align-items:center;
  justify-content:center;
  font-size:17pt;
  font-weight:100;
}

/* Page No separator: one red vertical line ONLY inside the title row.
   It cannot continue into the metadata rows below. */
.ledger-title-row::after{
  content:"";
  position:absolute;
  top:0;
  bottom:0;
  right:50pt;
  width:1px;
  background:#c00000;
  pointer-events:none;
  z-index:2;
}
.ledger-meta{
  display:grid;
  width:100%;
  grid-template-columns:22% 24.45% 53.55%;
  grid-template-rows:28pt 28pt 20pt;
}
.meta-row{
  display:grid;
  grid-template-columns:1.05fr 1.18fr 1.05fr 1.18fr 1.05fr 0.72fr;
  grid-column:1/-1;
  position:relative;
  border-bottom:1px solid #555;
  z-index:1;
}
.meta-row > div{
  position:relative;
  border-right:1px solid #555;
  border-bottom:0;
  display:flex;
  align-items:center;
  justify-content:center;
  text-align:center;
  min-width:0;
  overflow:hidden;
  white-space:nowrap;
  line-height:1;
}
.meta-row > div:last-child{border-right:0}
.meta-row:last-child{border-bottom:0}

.meta-key{
  font-size:13pt;
<!--  font-weight:700;-->
}
.meta-value{
  font-size:13pt;
  font-weight:100;
}
.meta-value.highlight{
  min-height:0;
  width:auto;
  align-self:stretch;
}

/* SHG name: yellow background ONLY on the value cell. */
.ledger-meta .meta-row:first-child .meta-value.highlight{
  background:#ffff00;
}
.meta-empty{
  font-size:12.5pt;
}
.ledger-table{
  /* Loan Ledger PDF: calibrated outer width. */
  width:784.500pt;
  max-width:none;
  border-collapse:collapse;
  table-layout:fixed;
  margin:0;
}
/* All 12 Loan Ledger columns start equal.
   Print-time fitting redistributes them according to actual content. */
.ledger-table col{width:auto}
.ledger-table col:first-child{width:24pt!important}
.ledger-table th,.ledger-table td{
  border:1px solid #555;
  padding:0 2pt;
  text-align:center;
  vertical-align:middle;
  overflow:visible;
}
.ledger-table th{
  white-space:normal;
}
.ledger-table tbody td{
  white-space:nowrap !important;
  overflow:visible !important;
  font-size:13pt !important;
  font-weight:400 !important;
  font-synthesis:none !important;
  line-height:1 !important;
}
.ledger-table thead .group-head{height:28pt}
.ledger-table thead .sub-head{height:20pt}
.ledger-table thead .number-head{height:15.7pt}
.ledger-table thead th{
  font-size:12pt;
  font-weight:100;
  line-height:1;
}
.ledger-table .number-head th{
  background:#b3b3b3;
  font-family:Arial,sans-serif;
  font-size:6pt;
  font-weight:700;
}
.ledger-table tbody tr{
  height:23.17pt;
}
.ledger-table tbody td{
  white-space:nowrap !important;
  overflow:visible !important;
  font-size:13pt !important;
  font-weight:400 !important;
  font-synthesis:none !important;
  line-height:1 !important;
}
.ledger-table td.date,
.ledger-table td.date *{
  <!--font-family:Arial, Helvetica, sans-serif !important;-->
  font-size:13pt !important;
  font-weight:100 !important;
  font-style:normal !important;
}
.ledger-table td.name{
  text-align:left;
  padding-left:5pt;
}

/* Keep the last Ledger column perfectly inside the frame.
   The frame and table have the same fixed width.  For the two header cells
   in the final column (the rowspan header and the number 13 cell), draw the
   right edge on the table itself so the border cannot project outside the
   frame due to collapsed-border rounding. */
.ledger-table{
  box-sizing:border-box !important;
  border-right:1px solid #555 !important;
}
.ledger-table tr > :first-child{
  border-left:0;
}
.ledger-table tr > :last-child{
  border-right:0;
}
.ledger-table thead tr.group-head > th:last-child,
.ledger-table thead tr.number-head > th:last-child{
  border-right:1px solid #555 !important;
}
.ledger-table tbody tr:last-child > td{
  border-bottom:0;
}

/* Final PDF header alignment: every top header block uses the exact same
   content width and only one horizontal rule separates adjacent rows. */
.pdf-report-type-header,
.dcb-report-type-full-row,
.cumulative-dcb-report-type-full-row{
  margin-left:0 !important;
  margin-right:0 !important;
  box-sizing:border-box !important;
}
.ledger-title-row,
.dcb-head,
.cumulative-dcb-head{
  margin-left:0 !important;
  margin-right:0 !important;
  box-sizing:border-box !important;
}
.ledger-title-row{
  border-top:0 !important;
}
.dcb-head,
.cumulative-dcb-head{
  border-top:1px solid #555 !important;
}


/* Yellow is a cell fill only; no pseudo-elements or extra yellow rules. */
.meta-value.highlight::before,
.meta-value.highlight::after{
  content:none !important;
  display:none !important;
}
.telugu{font-family:"Gidugu",Arial,sans-serif}

/* ---------------- DCB ---------------- */
/* DCB uses A4 landscape. Monthly DCB allows max 25 DATA rows/page.
   Empty rows are never added to the PDF. */
@page dcb{
  size:A4 landscape;
  margin:0;
}
.dcb-page{
  page:dcb;
  width:841.89pt;
  height:595.28pt;
  padding:28.3465pt;
  overflow:visible;
}
.dcb-frame{
  width:var(--dcb-width,785.197pt);
  margin-left:0;
  margin-right:0;
}
.dcb-top-blank{
  height:22pt;
 <!-- border-bottom:1px solid #555;-->
}

/* Full-width loan-type title row for DCB and Cumulative DCB.
   This is intentionally outside the fixed-layout table so PDF engines cannot
   collapse a colspan header into the first column after column fitting. */
.dcb-report-type-full-row,
.cumulative-dcb-report-type-full-row{
  width:var(--dcb-width,785.197pt);
  height:24pt;
  min-height:24pt;
  box-sizing:border-box;
  border:1px solid #555;
  border-bottom:0;
  display:flex;
  align-items:center;
  justify-content:center;
  text-align:center;
  font-family:"Gidugu",Arial,sans-serif;
  font-size:15.5pt;
  font-weight:100;
  line-height:1;
  white-space:nowrap;
  overflow:hidden;
  margin:0;
  padding:0 1.5pt;
}
.cumulative-dcb-report-type-full-row{
  width:var(--cumulative-dcb-width,785.197pt);
}
/* Default A4 safe-width boundary for Monthly DCB; runtime may use 6 mm fallback. */
.dcb-page .dcb-frame,
.dcb-page .dcb-head,
.dcb-page .dcb-table{
  box-sizing:border-box !important;
  margin-left:0 !important;
  margin-right:0 !important;
}

/* Final DCB header alignment: header and table share the same frame width. */
.dcb-frame > .dcb-head,
.cumulative-dcb-frame > .cumulative-dcb-head{
  box-sizing:border-box;
  margin-left:0!important;
  margin-right:0!important;
}
.dcb-head{
  width:var(--dcb-width,785.197pt);
  height:24pt;
  border-collapse:collapse;
  table-layout:fixed;
  border:1px solid #555;
  border-bottom:0;
  margin:0;
  box-sizing:border-box;
}
.dcb-head col{width:auto}
.dcb-head th{
  height:24pt;
  padding:0 1.5pt;
  text-align:center;
  vertical-align:middle;
  overflow:hidden;
  border:1px solid #555;
  border-bottom:0;
  box-sizing:border-box;
  font-family:"Gidugu",Arial,sans-serif;
  font-size:15.5pt;
  font-weight:100;
  line-height:1;
  white-space:nowrap;
}
.dcb-head-left,.dcb-head-right{
  text-align:center;
  vertical-align:middle;
}
.dcb-head .pdf-report-type-row th{
  height:24pt;
  border-bottom:1px solid #555;
  font-size:15.5pt;
}
.dcb-head-left{
  border-right:1px solid #555;
}
.dcb-table{
  width:var(--dcb-width,785.197pt);
  border-collapse:collapse;
  table-layout:fixed;
}
/* Default widths are exactly the previous DCB widths.
   JavaScript changes ONLY the col widths when a DATA CELL needs more room. */
/* All 17 DCB columns start equal.
   Print-time fitting redistributes them according to actual content. */
.dcb-table col{width:auto}
.dcb-table col:first-child{width:24pt!important}
.dcb-table th,.dcb-table td{
  border:1px solid #555;
  padding:0 1.5pt;
  text-align:center;
  vertical-align:middle;
  overflow:visible;
}
.dcb-table thead .group-head{height:28pt}
.dcb-table thead .sub-head{height:20pt}
.dcb-table thead .number-head{height:10pt}
/* Header text is soft: it may wrap so its column can donate width to long data. */
.dcb-table thead th{
  white-space:normal !important;
  overflow:hidden;
  word-break:normal;
  overflow-wrap:normal;
}
.dcb-table thead th{
  /* Same as LL table headings. */
  font-family:"Gidugu",Arial,sans-serif;
  font-size:13pt;
  font-weight:100;
  line-height:1;
}
.dcb-table .number-head td{
  background:#b3b3b3;
  /* Same as LL number row. */
  font-family:Arial,sans-serif;
  font-size:6pt;
  font-weight:700;
  line-height:1;
}
.dcb-table tbody tr.data-row{
  height:var(--dcb-data-row-height,18.6pt);
  min-height:var(--dcb-data-row-height,18.6pt);
  max-height:var(--dcb-data-row-height,18.6pt);
  break-inside:avoid;
  page-break-inside:avoid;
}
.dcb-table tbody td{
  /* One consistent base style for EVERY DCB data row. */
  font-family:"Gidugu",Arial,sans-serif !important;
  font-size:13pt !important;
  font-weight:400 !important;
  font-synthesis:none !important;
  line-height:1 !important;
  white-space:nowrap !important;
  overflow:visible !important;
}
.dcb-table tbody td.shg-name{
  text-align:left;
  padding-left:4pt;
  font-family:"Gidugu",Arial,sans-serif !important;
  font-size:13pt !important;
  font-weight:400 !important;
  font-synthesis:none !important;
}
.dcb-table tbody tr.total{
  height:24pt;
}
.dcb-table tbody tr.total td{
  font-family:"Gidugu",Arial,sans-serif !important;
  font-size:13pt !important;
  font-weight:400 !important;
  font-synthesis:none !important;
  white-space:nowrap !important;
  overflow:visible !important;
}

/* ---------------- CUMULATIVE DCB ---------------- */
@page cumulativeDcb{size:A4 landscape;margin:0}
.cumulative-dcb-page{
  page:cumulativeDcb;width:841.89pt;height:595.28pt;padding:28.3465pt;
  overflow:visible;
}
.cumulative-dcb-frame{
  width:var(--cumulative-dcb-width,785.197pt);margin-left:0;
  margin-right:0;
}
.cumulative-dcb-head{
  box-sizing:border-box;
  width:var(--cumulative-dcb-width);
  height:24pt;
  border-collapse:collapse;
  table-layout:fixed;
  border:1px solid #555;
  border-bottom:0;
  margin:0;
}
.cumulative-dcb-head col{width:auto}
.cumulative-dcb-head th{
  height:24pt;
  padding:0 1.5pt;
  text-align:center;
  vertical-align:middle;
  overflow:hidden;
  border:1px solid #555;
  border-bottom:0;
  box-sizing:border-box;
  font-family:"Gidugu",Arial,sans-serif;
  font-size:15.5pt;
  font-weight:100;
  line-height:1;
  white-space:nowrap;
}
.cumulative-dcb-head-left,.cumulative-dcb-head-right{
  text-align:center;
  vertical-align:middle;
}
.cumulative-dcb-head .pdf-report-type-row th{
  height:24pt;
  border-bottom:1px solid #555;
  font-size:15.5pt;
}
.cumulative-dcb-head-left{
  border-right:1px solid #555;
}
.cumulative-dcb-table{
  width:var(--cumulative-dcb-width);border-collapse:collapse;table-layout:fixed;
}
.cumulative-dcb-table col{width:auto}
.cumulative-dcb-table col:first-child{width:24pt!important}
.cumulative-dcb-table th,.cumulative-dcb-table td{
  border:1px solid #555;padding:0 1.5pt;text-align:center;
  vertical-align:middle;overflow:visible;
}
.cumulative-dcb-table thead .group-head{height:28pt}
.cumulative-dcb-table thead .sub-head{height:20pt}
.cumulative-dcb-table thead .number-head{height:10pt}
/* Cumulative DCB headers are soft and may wrap when data needs width. */
.cumulative-dcb-table thead th{
  white-space:normal !important;
  overflow:hidden;
  word-break:normal;
  overflow-wrap:normal;
}
.cumulative-dcb-table thead th{
  font-family:"Gidugu",Arial,sans-serif;font-size:13pt;font-weight:100;line-height:1;
}
.cumulative-dcb-table .number-head td{
  background:#b3b3b3;font-family:Arial,sans-serif;font-size:6pt;font-weight:700;line-height:1;
}
/*
 * Exactly 25 DATA rows are allocated on a normal cumulative-DCD page.
 * There are no filler rows; if fewer than 25 SHGs exist, only real rows print.
 */
.cumulative-dcb-table tbody tr.data-row{
  height:var(--cumulative-dcb-data-row-height,18pt);
  min-height:var(--cumulative-dcb-data-row-height,18pt);
  max-height:var(--cumulative-dcb-data-row-height,18pt);
  break-inside:avoid;
  page-break-inside:avoid;
}
.cumulative-dcb-table tbody td{
  font-family:"Gidugu",Arial,sans-serif !important;
  font-size:13pt !important;
  font-weight:400 !important;
  font-synthesis:none !important;
  line-height:1 !important;
  white-space:nowrap !important;
  overflow:visible !important;
  height:var(--cumulative-dcb-data-row-height,18pt);
  max-height:var(--cumulative-dcb-data-row-height,18pt);
}
.cumulative-dcb-table tbody td.shg-name{
  text-align:left;padding-left:4pt;font-family:"Gidugu",Arial,sans-serif !important;
}
/*
 * Total is NOT counted as one of the 25 data rows.
 * It appears after row 25 on the final page.
 */
.cumulative-dcb-table tbody tr.total{
  height:20pt;
  min-height:20pt;
  max-height:20pt;
}
.cumulative-dcb-table tbody tr{
  break-inside:avoid;
  page-break-inside:avoid;
}
.cumulative-dcb-page{
  break-after:page;
  page-break-after:always;
}
.cumulative-dcb-page:last-child{
  break-after:auto;
  page-break-after:auto;
}
.cumulative-dcb-table tbody tr.total td{
  font-family:"Gidugu",Arial,sans-serif !important;font-size:13pt !important;
  font-weight:400 !important;font-synthesis:none !important;
  white-space:nowrap !important;overflow:visible !important;
}

</style>
</head>
<body>${body}<style id="report-ledger-exact-layout-fix">
/* REPORT CENTER ONLY: restore the Loan Ledger screen preview to the same
   structure, typography and metadata geometry used by the PDF. */
@media screen{
  .report-preview .ledger-page{
    font-family:"Gidugu",Arial,sans-serif !important;
    color:#111 !important;
  }
  .report-preview .ledger-frame{
    width:var(--ledger-width,784.5pt) !important;
    min-width:var(--ledger-width,784.5pt) !important;
    max-width:var(--ledger-width,784.5pt) !important;
    margin:0 !important;
    border:1px solid #555 !important;
    box-sizing:border-box !important;
  }
  .report-preview .ledger-blank{
    height:22pt !important;
    border-bottom:1px solid #555 !important;
    box-sizing:border-box !important;
  }
  .report-preview .ledger-title-row{
    display:grid !important;
    grid-template-columns:minmax(0,1fr) 55pt 50pt !important;
    width:100% !important;
    height:34pt !important;
    min-height:34pt !important;
    border-top:0 !important;
    border-bottom:1px solid #555 !important;
    box-sizing:border-box !important;
    position:relative !important;
    overflow:hidden !important;
  }
  .report-preview .ledger-title{
    display:flex !important;
    align-items:center !important;
    justify-content:center !important;
    width:auto !important;
    min-width:0 !important;
    height:100% !important;
    border-right:1px solid #555 !important;
    font-family:"Gidugu",Arial,sans-serif !important;
    font-size:15.5pt !important;
    line-height:1 !important;
    text-align:center !important;
    white-space:nowrap !important;
    overflow:hidden !important;
    box-sizing:border-box !important;
  }
  .report-preview .ledger-loan-title,
  .report-preview .ledger-name-title{
    display:inline-block !important;
    white-space:nowrap !important;
    font-family:"Gidugu",Arial,sans-serif !important;
    font-size:15.5pt !important;
    line-height:1 !important;
  }
  .report-preview .page-label{
    display:flex !important;
    align-items:center !important;
    justify-content:center !important;
    width:auto !important;
    height:100% !important;
    font-family:Arial,sans-serif !important;
    font-size:8pt !important;
    font-weight:700 !important;
    box-sizing:border-box !important;
  }
  .report-preview .page-number{
    display:flex !important;
    align-items:center !important;
    justify-content:center !important;
    width:auto !important;
    height:100% !important;
    font-family:"Gidugu",Arial,sans-serif !important;
    font-size:17pt !important;
    line-height:1 !important;
    font-weight:100 !important;
    box-sizing:border-box !important;
  }
  .report-preview .ledger-title-row::after{
    top:0 !important;
    bottom:0 !important;
    right:50pt !important;
    width:1px !important;
    background:#c00000 !important;
  }
  .report-preview .ledger-meta{
    display:grid !important;
    width:100% !important;
    grid-template-columns:22% 24.45% 53.55% !important;
    grid-template-rows:28pt 28pt 20pt !important;
    box-sizing:border-box !important;
    font-family:"Gidugu",Arial,sans-serif !important;
  }
  .report-preview .ledger-meta .meta-row{
    display:grid !important;
    grid-template-columns:1.05fr 1.18fr 1.05fr 1.18fr 1.05fr .72fr !important;
    grid-column:1 / -1 !important;
    width:100% !important;
    height:auto !important;
    min-height:0 !important;
    border-bottom:1px solid #555 !important;
    box-sizing:border-box !important;
  }
  .report-preview .ledger-meta .meta-row > div{
    display:flex !important;
    align-items:center !important;
    justify-content:center !important;
    width:auto !important;
    min-width:0 !important;
    height:100% !important;
    border-right:1px solid #555 !important;
    border-bottom:0 !important;
    font-family:"Gidugu",Arial,sans-serif !important;
    font-size:13pt !important;
    line-height:1 !important;
    text-align:center !important;
    white-space:nowrap !important;
    overflow:hidden !important;
    box-sizing:border-box !important;
  }
  .report-preview .ledger-meta .meta-row > div:last-child{
    border-right:0 !important;
  }
  .report-preview .ledger-meta .meta-key{
    font-family:"Gidugu",Arial,sans-serif !important;
    font-size:13pt !important;
  }
  .report-preview .ledger-meta .meta-value,
  .report-preview .ledger-meta .meta-empty{
    font-family:"Gidugu",Arial,sans-serif !important;
    font-size:13pt !important;
  }
  .report-preview .ledger-meta .meta-value.highlight{
    min-height:0 !important;
    width:auto !important;
    align-self:stretch !important;
  }
  .report-preview .ledger-meta .meta-row:first-child .meta-value.highlight{
    background:#ffff00 !important;
  }
  .report-preview .ledger-table{
    width:var(--ledger-width,784.5pt) !important;
    min-width:var(--ledger-width,784.5pt) !important;
    max-width:var(--ledger-width,784.5pt) !important;
    margin:0 !important;
    border-collapse:collapse !important;
    table-layout:fixed !important;
    border:1px solid #555 !important;
    box-sizing:border-box !important;
    font-family:"Gidugu",Arial,sans-serif !important;
  }
  .report-preview .ledger-table th,
  .report-preview .ledger-table td{
    border:1px solid #555 !important;
    box-sizing:border-box !important;
  }
  .report-preview .ledger-table thead th{
    font-family:"Gidugu",Arial,sans-serif !important;
    font-size:12pt !important;
    line-height:1 !important;
    font-weight:100 !important;
  }
  .report-preview .ledger-table tbody td{
    font-family:"Gidugu",Arial,sans-serif !important;
    font-size:13pt !important;
    line-height:1 !important;
    font-weight:400 !important;
    white-space:nowrap !important;
    overflow:visible !important;
  }
}
</style>

</body>

<style id="pdf-header-line-and-alignment-fix">
.pdf-report-type-header,
.dcb-report-type-full-row,
.cumulative-dcb-report-type-full-row{
  box-sizing:border-box !important;
  margin-left:0 !important;
  margin-right:0 !important;
  border-bottom:0 !important;
}
.ledger-title-row{border-top:0 !important;}
.ledger-report-type-header{border-bottom:0 !important;}
.dcb-head,.cumulative-dcb-head{border-top:1px solid #555 !important;}
.dcb-head,.cumulative-dcb-head{table-layout:fixed !important;border-collapse:collapse !important;}
.dcb-head > colgroup > col,.cumulative-dcb-head > colgroup > col{box-sizing:border-box !important;}
.dcb-head tbody tr:first-child th,.cumulative-dcb-head tbody tr:first-child th{box-sizing:border-box !important;overflow:hidden !important;white-space:nowrap !important;}
</style>
</html>`);

      w.document.close();

      const printWhenReady=async()=>{
        try{
          if(w.document.fonts && w.document.fonts.load){
            await w.document.fonts.load('400 13pt "Gidugu"');
            await w.document.fonts.load('100 13pt "Gidugu"');
            await w.document.fonts.load('700 17pt "Gidugu"');
            await w.document.fonts.load('700 12.5pt "Gidugu"');
            await w.document.fonts.ready;
          }
        }catch(e){}
        setTimeout(()=>{
          try{
            /* One universal fitter handles Ledger, Monthly DCB and
               Cumulative DCB. No per-cell font fitting is used. */
            fitAllPDFTablesInPrintWindow(w);

            /*
             * Must run LAST: all table fitting/scaling is complete now,
             * so the DCB headers can copy the final table transform and
             * use the final fitted column widths.
             */
            syncDcbHeadersAfterFit(w);

            w.document.title=printTitle;
          }catch(e){}
          w.print();
        },200);
      };
      printWhenReady();
    }

    /*
     * DCB PAGE LAYOUT
     * ----------------
     * Every DCB table starts with equal columns. The universal print-time
     * engine then expands/redistributes them according to actual data.
     */
    function getDCBPageLayout(v){
      const A4_WIDTH=841.89;
      const MIN_MARGIN=28.3465;
      const totalWidth=A4_WIDTH-(MIN_MARGIN*2); // fixed 10 mm safe area on all sides
      const columnCount=17;
      const widths=Array(columnCount).fill(
        (totalWidth-FIXED_SN_WIDTH)/(columnCount-1)
      );
      widths[0]=FIXED_SN_WIDTH;

      return {
        widths,
        totalWidth,
        left:MIN_MARGIN,
        right:MIN_MARGIN
      };
    }

    /* MS LOGIN PDF RULE (STRICT):
     * Monthly DCB + Cumulative DCB header: MS -> Mandal -> District.
     * Loan Ledger first metadata row: child name + Mandal + District.
     * These rules are active only while currentMode === "MS".
     */
    let reportPreviewActive=false;
    let reportPreviewMemberId="ALL";
    let reportPreviewLoanType="cif";
    let reportPreviewMonth="ALL";

    function reportAccounts(v,forcedLoanKey=null){
      if(!v)return [];
      const memberFilter=reportPreviewActive ? reportPreviewMemberId : "ALL";
      const loanFilter=forcedLoanKey || (reportPreviewActive ? reportPreviewLoanType : (selectedLoanType||defaultLoanTypeKey()));

      ensureLoanData(v);
      const out=[];
      (v.shgs||[]).forEach(member=>{
        if(memberFilter!=="ALL"&&member.id!==memberFilter)return;
        const types=loanFilter==="ALL" ? loanTypesForMode() : loanTypesForMode().filter(type=>type.key===loanFilter);
        types.forEach(type=>{
          const account=member.loans[type.key];
          if(account)out.push({member,account,loanKey:type.key});
        });
      });
      return out;
    }

    function reportLoanTypesForPdf(v){
      const types=loanTypesForMode();
      const selected=reportPreviewActive ? reportPreviewLoanType : (selectedLoanType||defaultLoanTypeKey());
      if(selected==="ALL")return types;
      return types.filter(type=>type.key===selected);
    }
    function reportChildName(entry){
      /* Keep the SHG / VO / Member name clean. Loan type is shown separately
         in the report header and in the "అప్పు రకం" field. */
      return entry?.member?.name||"";
    }

    function monthlyPDF(asPart=false){
      const v=vo();
      if(!v)return;
      if(!ensurePdfFinancialYear(v))return "";
      currentFinancialYear=v.financialYear;
      MONTHS=buildMonths(currentFinancialYear);

      const dcbLayout=getDCBPageLayout(v);
      const dcbColStyle=dcbLayout.widths.map(w=>`<col style="width:${w.toFixed(3)}pt">`).join("");
      const dcbPageStyle=`--dcb-width:${dcbLayout.totalWidth.toFixed(3)}pt;--dcb-left:${dcbLayout.left.toFixed(3)}pt;--dcb-right:${dcbLayout.right.toFixed(3)}pt;`;

      let out="";

      /* When ALL Loans is selected, render one completely separate set of
       * DCB pages for each loan type. Never mix different loan types on the
       * same DCB page. */
      const dcbMonths=(reportPreviewActive && reportPreviewMonth!=="ALL")
        ? MONTHS.filter(m=>m[0]===reportPreviewMonth)
        : MONTHS;

      reportLoanTypesForPdf(v).forEach(loanType=>{
        dcbMonths.forEach((m,mi)=>{
        const allRows=[];
        const totals=Array(15).fill(0);
        let monthlySerial=0;

        reportAccounts(v,loanType.key).forEach((entry,i)=>{
          const s=entry.member, account=entry.account;
          const d=account.months[m[0]];
          if(!monthIsConsidered(d)) return;
          let opening=d.opening;


          const x={...d,opening};
          const c=calc(x);

          /* Monthly DCB PDF:
           * "ఈ నెల డిమాండ్ అసలు" / Current Month Principal must
           * display the value entered for this same month and SHG.
           */
          const currentMonthPrincipal = Number(d.demandPrincipal)||0;

          const vals=[
            opening,
            d.prevPrincipal,
            d.prevInterest,
            currentMonthPrincipal,
            d.demandInterest,
            d.prevPrincipal+currentMonthPrincipal,
            d.prevInterest+d.demandInterest,
            d.prevPrincipal+currentMonthPrincipal+d.prevInterest+d.demandInterest,
            d.principalCollection,
            d.interestCollection,
            c.totalCollection,
            c.balancePrincipal,
            c.balanceInterest,
            d.newLoan,
            c.totalLoanBalance
          ];

          vals.forEach((n,j)=>totals[j]+=Number(n)||0);

          allRows.push(`
            <tr class="data-row">
              <td>${++monthlySerial}</td>
              <td class="shg-name telugu">${esc(reportChildName(entry))}</td>
              ${vals.map(n=>`<td>${fmt(n)}</td>`).join("")}
            </tr>
          `);
        });

        /*
         * If this month has no completed/considered SHG records,
         * do NOT create a DCB page at all.
         *
         * This prevents an empty month's DCB header from printing.
         */
        if(allRows.length===0) return;

        /*
         * Monthly DCB pagination:
         * maximum 25 real SHG data rows on each A4 landscape page.
         */
        const MAX_DCB_DATA_ROWS_PER_PAGE=25;
        const chunks=[];

        for(let i=0;i<allRows.length;i+=MAX_DCB_DATA_ROWS_PER_PAGE){
          chunks.push(
            allRows.slice(i,i+MAX_DCB_DATA_ROWS_PER_PAGE)
          );
        }

        const totalCells=totals.map(n=>`<td>${fmt(n)}</td>`).join("");

        const nums=[
          "1","2","3","4","5","6","7","8","9","10","11",
          "12","13","14","15","16","17"
        ];

        chunks.forEach((chunk,chunkIndex)=>{
          const isLastPage=chunkIndex===chunks.length-1;
          /*
           * Do NOT pad the table with empty rows.
           * Only real SHG records are rendered.
           * MAX_DCB_DATA_ROWS_PER_PAGE controls pagination only:
           * 25 real rows maximum on each page.
           */
          const blankRows="";

          out+=`
            <section class="page dcb-page" style="${dcbPageStyle}">
              <div class="dcb-frame">
                <!-- Blank/tab-space row at the top of every DCB page. -->
                <div class="dcb-top-blank"></div>
                <div class="dcb-report-type-full-row telugu">
                  ${pdfDcbTopHeaderText(loanType.key)}
                </div>
                <div class="dcb-head dcb-head-grid" data-left-span="10" data-right-span="7">
                  <div class="dcb-head-left telugu">
                    ${pdfHeaderLocationText(v)}
                  </div>
                  <div class="dcb-head-right">
                    DCB-${m[0].toUpperCase()}
                  </div>
                </div>

                <table class="dcb-table">
                  <colgroup>
                    ${dcbColStyle}
                  </colgroup>
                  <thead>
                    <tr class="group-head">
                      <th rowspan="2">S.N</th>
                      <th rowspan="2"><span class="telugu">${pdfChildNameLabel()} పేరు</span></th>
                      <th rowspan="2"><span class="telugu">ప్రారంభ<br>అప్పు నిల్వ</span></th>
                      <th colspan="2"><span class="telugu">గత నెల బకాయి<br>వివరాలు</span></th>
                      <th colspan="2"><span class="telugu">ఈ నెల డిమాండ్</span></th>
                      <th colspan="3"><span class="telugu">గతనెల బకాయి తో కలిపి ఈ నెల<br>వరకు మొత్తం డిమాండ్</span></th>
                      <th colspan="3"><span class="telugu">ఈ నెల కలెక్షన్ వివరాలు</span></th>
                      <th colspan="2"><span class="telugu">బకాయి</span></th>
                      <th rowspan="2"><span class="telugu">కొత్త<br>అప్పు</span></th>
                      <th rowspan="2"><span class="telugu">ముగింపు<br>అప్పు నిల్వ</span></th>
                    </tr>
                    <tr class="sub-head">
                      <th><span class="telugu">అసలు</span></th>
                      <th><span class="telugu">వడ్డీ</span></th>
                      <th><span class="telugu">అసలు</span></th>
                      <th><span class="telugu">వడ్డీ</span></th>
                      <th><span class="telugu">అసలు</span></th>
                      <th><span class="telugu">వడ్డీ</span></th>
                      <th><span class="telugu">మొత్తం</span></th>
                      <th><span class="telugu">అసలు</span></th>
                      <th><span class="telugu">వడ్డీ</span></th>
                      <th><span class="telugu">మొత్తం</span></th>
                      <th><span class="telugu">అసలు</span></th>
                      <th><span class="telugu">వడ్డీ</span></th>
                    </tr>
                    <tr class="number-head">
                      ${nums.map(n=>`<td>${n}</td>`).join("")}
                    </tr>
                  </thead>
                  <tbody>
                    ${chunk.join("")}
                    ${blankRows}
                    ${
                      isLastPage
                      ? `<tr class="total"><td></td><td class="telugu">మొత్తం</td>${totalCells}</tr>`
                      : ""
                    }
                  </tbody>
                </table>
              </div>
            </section>`;
        });
      });
      });

      if(asPart) return out;
      printReport("DCB",out);
    }


    /*
     * CUMULATIVE DCB PDF
     * One row per SHG for Apr-26 through Mar-27.
     *
     * Annual calculation:
     * - Opening = April opening balance.
     * - Previous due = April previous due.
     * - Demand = sum of all stored monthly demands.
     * - Previous + current demand = sum of each month's combined demand.
     * - Collection = sum of all stored monthly collections.
     * - Balance = March year-end balance when March exists.
     * - New Loan = sum of all stored monthly new loans.
     *
     * The visual structure follows the 15-column cumulative DCB format shown in the reference image.
     * Exactly 25 DATA rows are allocated to each page; the final page also
     * contains the Total row.  Rows are kept together and are not split.
     */

    /* CUMULATIVE DCB: 15-COLUMN SCREENSHOT STRUCTURE */
    function cumulativeDcbPDF(asPart=false){
      const v=vo();
      if(!v||!v.shgs.length){
        if(!asPart) alert(`Select a ${pdfParentLabel()} with ${pdfChildLabel()}s.`);
        return "";
      }
      if(!ensurePdfFinancialYear(v))return "";
      currentFinancialYear=v.financialYear;
      MONTHS=buildMonths(currentFinancialYear);

      const A4_WIDTH=841.89, MARGIN=28.3465;
      const totalWidth=A4_WIDTH-(MARGIN*2);

      /*
       * Cumulative DCB has 15 columns:
       * 1  S.No
       * 2  SHG Name
       * 3  Opening Loan Balance
       * 4-5 Previous Due: Principal / Interest
       * 6-8 Previous Due + Current Demand: Principal / Interest / Total
       * 9-11 Collection: Principal / Interest / Total
       * 12-13 Balance: Principal / Interest
       * 14 New Loan
       * 15 Closing Loan Balance
       */
      const columnCount=13;
      const widths=Array(columnCount).fill(totalWidth/columnCount);
      const colStyle=widths.map(w=>`<col style="width:${w.toFixed(3)}pt">`).join("");
      const pageStyle=
        `--cumulative-dcb-width:${totalWidth.toFixed(3)}pt;`+
        `--cumulative-dcb-left:${MARGIN.toFixed(3)}pt;`+
        `--cumulative-dcb-right:${MARGIN.toFixed(3)}pt;`;

      /* Numeric columns 3 through 13 = 11 displayed columns. */
      let out="";

      /* When ALL Loans is selected, each loan type gets its own completely
       * separate cumulative DCB page set. No mixed-loan rows are printed. */
      reportLoanTypesForPdf(v).forEach(loanType=>{
        const totals=Array(11).fill(0);
        const rows=[];
        let cumulativeSerial=0;

      reportAccounts(v,loanType.key).forEach((entry,i)=>{
        const s=entry.member, account=entry.account;
        const startIdx=Number.isInteger(account.startMonthIndex)?account.startMonthIndex:0;
        const april=account.months[MONTHS[0][0]]||blank();

        let collectP=0,collectI=0,newLoan=0;
        let lastEntered=null;
        let hasAnyData=false;

        /*
         * Cumulative DCB demand is represented by the latest entered month's
         * previous due + current demand. Collections and new loans are the
         * cumulative sums across all entered months.
         */
        MONTHS.forEach(m=>{
          const d=account.months[m[0]];
          if(!monthIsConsidered(d))return;
          hasAnyData=true;

          lastEntered=d;
          collectP+=Number(d.principalCollection)||0;
          collectI+=Number(d.interestCollection)||0;
          newLoan+=Number(d.newLoan)||0;
        });

        if(!hasAnyData)return;

        /* A mid-year SHG has no April record. Its own creation month is the
         * beginning of its accounting period; earlier months intentionally do
         * not participate in its cumulative totals. April-created SHGs still
         * begin in April as before. */
        const baseData=account.months[MONTHS[startIdx][0]]||blank();
        const opening=Number(baseData.opening)||0;

        /*
         * CUMULATIVE DCB - PREVIOUS DUE
         * --------------------------------
         * "గత బకాయి" must ALWAYS be taken from APRIL:
         *   Previous Due Principal -> April prevPrincipal
         *   Previous Due Interest  -> April prevInterest
         *
         * Do not use the latest month's previous due for these two columns.
         */
        const previousP=Number(baseData.prevPrincipal)||0;
        const previousI=Number(baseData.prevInterest)||0;

        /*
         * CUMULATIVE DCB:
         * Column 6 = Column 4 (April Previous Due Principal)
         *             + Column 6's demand value accumulated so far.
         *
         * Column 7 = Column 5 (April Previous Due Interest)
         *             + Column 7's demand value accumulated so far.
         *
         * In other words:
         *   Column 6 = Previous Due Principal + cumulative Demand Principal
         *   Column 7 = Previous Due Interest  + cumulative Demand Interest
         *
         * The separate Previous Due columns remain the April values.
         */
        let cumulativeDemandP=0;
        let cumulativeDemandI=0;

        MONTHS.forEach(m=>{
          const d=account.months[m[0]];
          if(!monthIsConsidered(d))return;

          cumulativeDemandP += Number(d.demandPrincipal)||0;
          cumulativeDemandI += Number(d.demandInterest)||0;
        });

        const combinedP=
          (Number(previousP)||0) + cumulativeDemandP;

        const combinedI=
          (Number(previousI)||0) + cumulativeDemandI;

        const totalDemand=
          (Number(combinedP)||0) + (Number(combinedI)||0);

        const totalCollection=
          (Number(collectP)||0) + (Number(collectI)||0);
        const balanceP=(Number(combinedP)||0)-(Number(collectP)||0);
        const balanceI=(Number(combinedI)||0)-(Number(collectI)||0);

        /* Closing balance must come from the latest month that actually has
         * data. This is important for a SHG created in the middle of the year:
         * its creation-month New Loan must flow into the next month's opening
         * balance without being counted a second time. If March is entered, it
         * naturally becomes the latest month and is used. */
        const latestCalc=lastEntered?calc(lastEntered):null;
        const closing=latestCalc
          ? Number(latestCalc.totalLoanBalance)||0
          : opening-collectP+newLoan;

        /* Previous Due ("గత బకాయి") is intentionally omitted from the
         * cumulative PDF display. The existing calculations above are unchanged. */
        const vals=[
          opening,
          combinedP,combinedI,totalDemand,
          collectP,collectI,totalCollection,
          balanceP,balanceI,
          newLoan,
          closing
        ];

        vals.forEach((n,j)=>totals[j]+=Number(n)||0);

        rows.push(`
          <tr class="data-row">
            <td>${++cumulativeSerial}</td>
            <td class="shg-name">${esc(reportChildName(entry))}</td>
            ${vals.map(n=>`<td>${fmt(n)}</td>`).join("")}
          </tr>
        `);
      });

      if(!rows.length)return;

      const MAX_ROWS=25;
      const chunks=[];
      for(let i=0;i<rows.length;i+=MAX_ROWS){
        chunks.push(rows.slice(i,i+MAX_ROWS));
      }
      if(!chunks.length)chunks.push([]);

      const totalCells=totals.map(n=>`<td>${fmt(n)}</td>`).join("");
      const nums=[
        "1","2","3","4","5","6","7","8","9","10",
        "11","12","13"
      ];

      chunks.forEach((chunk,idx)=>{
        const last=idx===chunks.length-1;

        out+=`
          <section class="page cumulative-dcb-page" style="${pageStyle}">
            <div class="cumulative-dcb-frame">
              <div class="dcb-top-blank"></div>

              <div class="cumulative-dcb-report-type-full-row telugu">
                ${pdfDcbTopHeaderText(loanType.key)}
              </div>
              <div class="cumulative-dcb-head cumulative-dcb-head-grid" data-left-span="8" data-right-span="5">
                <div class="cumulative-dcb-head-left telugu">
                  ${pdfHeaderLocationText(v)}
                </div>
                <div class="cumulative-dcb-head-right">
                  Cumulative DCB ${esc(pdfFinancialYear(v))}
                </div>
              </div>

              <table class="cumulative-dcb-table">
                <colgroup>${colStyle}</colgroup>
                <thead>
                  <tr class="group-head">
                    <th rowspan="2">S.N</th>
                    <th rowspan="2"><span class="telugu">${pdfChildNameLabel()} పేరు</span></th>
                    <th rowspan="2"><span class="telugu">ప్రారంభ<br>అప్పు నిల్వ</span></th>

                    <th colspan="3">
                      <span class="telugu">డిమాండ్</span>
                    </th>

                    <th colspan="3">
                      <span class="telugu">కలెక్షన్</span>
                    </th>

                    <th colspan="2">
                      <span class="telugu">బకాయి</span>
                    </th>

                    <th rowspan="2">
                      <span class="telugu">కొత్త<br>అప్పు</span>
                    </th>

                    <th rowspan="2">
                      <span class="telugu">ముగింపు అప్పు<br>నిల్వ</span>
                    </th>
                  </tr>

                  <tr class="sub-head">
                    <!-- Previous + Current Demand -->
                    <th><span class="telugu">అసలు</span></th>
                    <th><span class="telugu">వడ్డీ</span></th>
                    <th><span class="telugu">మొత్తం</span></th>

                    <!-- Collection -->
                    <th><span class="telugu">అసలు</span></th>
                    <th><span class="telugu">వడ్డీ</span></th>
                    <th><span class="telugu">మొత్తం</span></th>

                    <!-- Balance -->
                    <th><span class="telugu">అసలు</span></th>
                    <th><span class="telugu">వడ్డీ</span></th>
                  </tr>

                  <tr class="number-head">
                    ${nums.map(n=>`<td>${n}</td>`).join("")}
                  </tr>
                </thead>

                <tbody>
                  ${chunk.join("")}
                  ${last?`<tr class="total"><td></td><td>మొత్తం</td>${totalCells}</tr>`:""}
                </tbody>
              </table>
            </div>
          </section>`;
      });
      });

      if(asPart) return out;
      printReport("Cumulative-DCB",out);
    }

    /*
     * LOAN LEDGER DATA-DRIVEN WIDTH ENGINE
     * ------------------------------------
     * 1. Start with the normal/reference LL widths.
     * 2. Inspect actual data cells for every month on this SHG's ledger.
     * 3. Expand only columns whose data needs more room.
     * 4. Use unused A4 margin space first.
     * 5. Never shrink base columns while margin space remains.
     * 6. Only constrain requested expansion when physical A4 width is exceeded.
     * 7. Center the final complete content block horizontally.
     */
    /*
     * LOAN LEDGER PAGE LAYOUT
     * All 12 columns start equal. The universal print-time fitting engine
     * performs the content-aware redistribution.
     */
    function getLedgerPageLayout(s,v){
      const A4_WIDTH=841.89;
      const MIN_MARGIN=28.3465;
      const totalWidth=A4_WIDTH-(MIN_MARGIN*2); // fixed 10 mm safe area on all sides
      const columnCount=12;
      const widths=Array(columnCount).fill(totalWidth/columnCount);

      return {
        widths,
        totalWidth,
        left:MIN_MARGIN,
        right:MIN_MARGIN
      };
    }

    function ledgerPDF(asPart=false){
      const v=vo();

      if(!v||!v.shgs.length){
        if(!asPart) alert(`Select a ${pdfParentLabel()} with ${pdfChildLabel()}s.`);
        return "";
      }

      if(!ensurePdfFinancialYear(v))return "";
      currentFinancialYear=v.financialYear;
      MONTHS=buildMonths(currentFinancialYear);

      let out="";
      let ledgerSerial=0;

      reportAccounts(v).forEach((entry,si)=>{
        const s=entry.member, account=entry.account;
        const ledgerLayout=getLedgerPageLayout(s,v);
        const ledgerColStyle=ledgerLayout.widths
          .map(w=>`<col style="width:${w.toFixed(3)}pt">`)
          .join("");
        const ledgerPageStyle=
          `--ledger-width:${ledgerLayout.totalWidth.toFixed(3)}pt;`+
          `--ledger-left:${ledgerLayout.left.toFixed(3)}pt;`+
          `--ledger-right:${ledgerLayout.right.toFixed(3)}pt;`;
        const allRows=[];

        MONTHS.forEach((m,i)=>{
          const d=account.months[m[0]];
          if(!monthIsConsidered(d))return;

          const c=calc(d);
          const p=d.prevPrincipal+d.demandPrincipal;
          const ii=d.prevInterest+d.demandInterest;

          allRows.push(`
            <tr>
              <td>${i+1}</td>
              <td class="date">${m[0]}</td>
              <td>${fmt(d.opening)}</td>
              <td>${fmt(p)}</td>
              <td>${fmt(ii)}</td>
              <td>${fmt(d.principalCollection)}</td>
              <td>${fmt(d.interestCollection)}</td>
              <td>${fmt(c.totalCollection)}</td>
              <td>${fmt(p-d.principalCollection)}</td>
              <td>${fmt(ii-d.interestCollection)}</td>
              <td>${fmt(d.newLoan)}</td>
              <td>${fmt(c.totalLoanBalance)}</td>
            </tr>
          `);
        });

        /* Reference LL has one page per SHG with entered/considered data. */
        if(!allRows.length)return;
        ledgerSerial++;
        out+=`
          <section class="page ledger-page" style="${ledgerPageStyle}">
            <div class="ledger-frame">
              <div class="ledger-blank"></div>

              <div class="ledger-title-row">
                <div class="ledger-title telugu">
                  <span class="ledger-loan-title">${pdfLedgerTopHeaderText(v,entry)}</span>
                </div>
                <div class="page-label">Page No:</div>
                <div class="page-number">${ledgerSerial}</div>
              </div>

              <div class="ledger-meta">
                <div class="meta-row">
                  <div class="meta-key telugu">${pdfChildNameLabel()} పేరు :</div>
                  <div class="meta-value highlight telugu">${esc(reportChildName(entry))}</div>
                  ${pdfLedgerLocationMeta(v)}
                </div>

                <div class="meta-row">
                  <div class="meta-key telugu">అప్పు ఇచ్చిన తేది :</div>
                  <div class="meta-empty"></div>
                  <div class="meta-key telugu">అప్పు మొత్తం రూ. :</div>
                  <div class="meta-empty"></div>
                  <div class="meta-key telugu">వడ్డీ రేటు :</div>
                  <div class="meta-value highlight">${fmt(s.interestRate===undefined?12:s.interestRate)}%</div>
                </div>

                <div class="meta-row">
                  <div class="meta-key telugu">వాయిదాల సంఖ్య :</div>
                  <div class="meta-empty"></div>
                  <div class="meta-key telugu">వాయిదా మొత్తం రూ. :</div>
                  <div class="meta-empty"></div>
                  <div class="meta-key telugu">అప్పు రకం :</div>
                  <div class="meta-value highlight">${esc(loanTypeDisplayLabel(entry?.loanKey||defaultLoanTypeKey()))}</div>
                </div>
              </div>

              <table class="ledger-table">
                <colgroup>${ledgerColStyle}</colgroup>
                <thead>
                  <tr class="group-head">
                    <th rowspan="2">S.N</th>
                    <th rowspan="2" class="telugu">తేది</th>
                    <th rowspan="2" class="telugu">ప్రారంభ అప్పు<br>నిల్వ</th>
                    <th colspan="2" class="telugu">గత నెల బకాయి + ఈ<br>నెల డిమాండ్</th>
                    <th colspan="3" class="telugu">ఈ నెల కలెక్షన్ వివరాలు</th>
                    <th colspan="2" class="telugu">బకాయి</th>
                    <th rowspan="2" class="telugu">కొత్త అప్పు</th>
                    <th rowspan="2" class="telugu">మొత్తం అప్పు నిల్వ</th>
                  </tr>
                  <tr class="sub-head">
                    <th class="telugu">అసలు</th>
                    <th class="telugu">వడ్డీ</th>
                    <th class="telugu">అసలు</th>
                    <th class="telugu">వడ్డీ</th>
                    <th class="telugu">మొత్తం</th>
                    <th class="telugu">అసలు</th>
                    <th class="telugu">వడ్డీ</th>
                  </tr>
                  <tr class="number-head">
                    <th>1</th><th>2</th><th>3</th><th>4</th><th>5</th><th>6</th><th>7</th><th>8</th><th>10</th><th>11</th><th>12</th><th>13</th>
                  </tr>
                </thead>
                <tbody>${allRows.join("")}</tbody>
              </table>
            </div>
          </section>`;
      });

      if(asPart) return out;
      printReport("LL",out);
    }

    /*
     * ALL 3 PDFS - SINGLE PRINT/PDF DOCUMENT
     * ----------------------------------------
     * Builds the three existing report bodies in their normal order:
     *   1. Monthly DCB
     *   2. Cumulative DCB
     *   3. Loan Ledger
     * and sends all pages to ONE browser print document.
     *
     * Browser Save-as-PDF will therefore create ONE PDF containing all
     * three reports. The document title is also used as the suggested
     * PDF filename: dynamically uses the selected VO name, e.g. Laxmi-VO.pdf.
     */
    function allPdfsPDF(){
      const v=vo();
      if(!v||!v.shgs.length){
        alert(`Select a ${pdfParentLabel()} with ${pdfChildLabel()}s.`);
        return;
      }

      const monthly=monthlyPDF(true)||"";
      const ledger=ledgerPDF(true)||"";
      const cumulative=cumulativeDcbPDF(true)||"";

      /*
       * Combined PDF order:
       *   1. Monthly DCB
       *   2. ONE completely blank A4 page
       *   3. Loan Ledger
       *   4. ONE completely blank A4 page
       *   5. Cumulative DCB
       *
       * The blank pages are intentional separator sheets so each report
       * starts as a clearly separated section in the single PDF.
       */
      const separator=`<section class="page combined-blank-page" aria-hidden="true"></section>`;
      const body=monthly+separator+ledger+separator+cumulative;

      if(!body.trim()){
        alert("There is no PDF data to print.");
        return;
      }

      printReport(pdfParentLabel(),body);
    }

    let currentReportType="";

    function populateReportMemberFilter(){
      const sel=document.getElementById("reportMemberFilter");
      if(!sel)return;
      const v=vo();
      const current=reportPreviewMemberId||"ALL";
      sel.innerHTML='<option value="ALL">ALL</option>';
      (v&&Array.isArray(v.shgs)?v.shgs:[]).forEach((member,i)=>{
        const option=document.createElement("option");
        option.value=member.id||String(i);
        option.textContent=member.name||(`${modeConfig().child} ${i+1}`);
        sel.appendChild(option);
      });
      sel.value=[...sel.options].some(o=>o.value===current)?current:"ALL";
      reportPreviewMemberId=sel.value;
    }

    function syncReportLoanOptions(){
      const field=document.getElementById("reportLoanField");
      const sel=document.getElementById("reportLoanFilter");
      if(!field||!sel)return;
      field.classList.remove("hidden");
      const types=loanTypesForMode();
      sel.innerHTML='<option value="ALL">ALL Loans</option>'+types.map(type=>`<option value="${type.key}">${type.label}</option>`).join("");
      sel.value=[...sel.options].some(o=>o.value===reportPreviewLoanType)?reportPreviewLoanType:defaultLoanTypeKey();
      reportPreviewLoanType=sel.value;
    }

    function syncReportMonthOptions(){
      const field=document.getElementById("reportMonthField");
      const sel=document.getElementById("reportMonthFilter");
      if(!field||!sel)return;
      field.classList.toggle("hidden",currentReportType!=="DCB");
      const current=reportPreviewMonth||"ALL";
      const months=Array.isArray(MONTHS)?MONTHS:[];
      sel.innerHTML='<option value="ALL">ALL Months</option>'+months.map(m=>`<option value="${m[0]}">${m[1]}</option>`).join("");
      sel.value=[...sel.options].some(o=>o.value===current)?current:"ALL";
      reportPreviewMonth=sel.value;
    }

    function updateReportCenterLabels(){
      const c=modeConfig();
      const title=document.getElementById("reportCenterTitle");
      const hint=document.getElementById("reportCenterHint");
      const memberLabel=document.getElementById("reportMemberLabel");
      if(title)title.textContent=`${c.parent} ${c.childPlural} Reports`;
      if(hint)hint.textContent=`Choose ${c.child.toLowerCase()} and loan, then show the report.`;
      if(memberLabel)memberLabel.textContent=c.child;
    }

    function openReportCenter(){
      const v=vo();
      if(!v){alert(`Select a ${pdfParentLabel()} first.`);return;}
      reportPreviewActive=false;
      reportPreviewMemberId="ALL";
      reportPreviewLoanType="bankLinkage";
      reportPreviewMonth="ALL";
      currentReportType="";
      updateReportCenterLabels();
      syncReportMonthOptions();
      populateReportMemberFilter();
      syncReportLoanOptions();
      const section=document.getElementById("reportCenterSection");
      const preview=document.getElementById("reportPreview");
      const downloads=document.getElementById("reportDownloadActions");
      if(section)section.classList.remove("hidden");
      if(preview){preview.innerHTML="";preview.classList.add("hidden");}
      if(downloads)downloads.classList.add("hidden");
      const toggleBtn=document.getElementById("showReportsBtn");
      if(toggleBtn)toggleBtn.textContent="Hide Reports";
      section?.scrollIntoView({behavior:"smooth",block:"start"});
    }

    function closeReportCenter(){
      reportPreviewActive=false;
      currentReportType="";
      reportPreviewMonth="ALL";
      syncReportMonthOptions();
      const section=document.getElementById("reportCenterSection");
      if(section)section.classList.add("hidden");
      const preview=document.getElementById("reportPreview");
      if(preview){preview.innerHTML="";preview.classList.add("hidden");}
      document.getElementById("reportDownloadActions")?.classList.add("hidden");
      document.querySelectorAll("#reportCenterSection .report-type-actions button").forEach(btn=>btn.classList.remove("report-selected"));
      const toggleBtn=document.getElementById("showReportsBtn");
      if(toggleBtn)toggleBtn.textContent="Show Reports";
    }

    function toggleReportCenter(){
      const section=document.getElementById("reportCenterSection");
      if(section && !section.classList.contains("hidden")) closeReportCenter();
      else openReportCenter();
    }

    function showReportInUi(type){
      const v=vo();
      if(!v){alert(`Select a ${pdfParentLabel()} first.`);return;}
      reportPreviewMemberId=document.getElementById("reportMemberFilter")?.value||"ALL";
      reportPreviewLoanType=document.getElementById("reportLoanFilter")?.value||"bankLinkage";
      currentReportType=type;
      reportPreviewActive=true;
      if(type!=="DCB")reportPreviewMonth="ALL";
      syncReportMonthOptions();

      document.querySelectorAll("#reportCenterSection .report-type-actions button").forEach(btn=>btn.classList.remove("report-selected"));
      const selectedButton=type==="DCB"?document.getElementById("showDcbReportBtn"):type==="LL"?document.getElementById("showLedgerReportBtn"):document.getElementById("showCumulativeReportBtn");
      if(selectedButton)selectedButton.classList.add("report-selected");

      let html="";
      if(type==="DCB")html=monthlyPDF(true)||"";
      else if(type==="LL")html=ledgerPDF(true)||"";
      else if(type==="CUMULATIVE")html=cumulativeDcbPDF(true)||"";

      const preview=document.getElementById("reportPreview");
      const downloads=document.getElementById("reportDownloadActions");
      const label=document.getElementById("currentReportLabel");
      if(!preview)return;

      /* Restore the report context line that was shown above the report preview.
         This is screen-only metadata; the PDF generation itself is untouched. */
      let selectedChild="ALL";
      if(reportPreviewMemberId!=="ALL"){
        const matched=(v.shgs||[]).find((member,index)=>String(member.id||index)===String(reportPreviewMemberId));
        selectedChild=matched?.name||"";
      }
      const selectedMonthKey=type==="DCB"&&reportPreviewMonth!=="ALL" ? reportPreviewMonth : MONTHS[monthIndex]?.[0];
      const selectedMonth=MONTHS.find(m=>m[0]===selectedMonthKey)||MONTHS[monthIndex]||["",""];
      let reportContext=`${pdfParentLabel()}: ${esc(v.name||"")}`;
      if(currentMode==="SHG") reportContext+=` | VO: ${esc(v.voName||document.getElementById("linkedVoName")?.value||"")}`;
      reportContext+=` | ${pdfChildLabel()}: ${esc(selectedChild)}`;
      if(type==="DCB") reportContext+=` | Month: ${esc(selectedMonth[1]||"")}`;
      const contextHtml=`<div class="report-ui-context">${reportContext}</div>`;

      if(!html.trim()){
        preview.innerHTML=contextHtml+'<div class="notice">No report data is available for the selected filter.</div>';
      }else{
        preview.innerHTML=contextHtml+html;
      }
      preview.classList.remove("hidden");
      if(downloads)downloads.classList.remove("hidden");
      const currentDownload=document.getElementById("downloadCurrentReportBtn");
      if(currentDownload){
        currentDownload.textContent=type==="DCB"?"Download DCB PDF":(type==="LL"?"Download Loan Ledger PDF":"Download Cumulative DCB PDF");
      }
      if(label)label.textContent=type==="DCB"?"Showing DCB Report":(type==="LL"?"Showing Loan Ledger Report":"Showing Cumulative DCB Report");

      /*
       * Report Center uses the exact same generated report HTML as the PDF.
       * Fit the rendered report tables with the same A4/table fitter used by
       * the PDF print window, then copy the final DCB/Cumulative header split.
       * This is scoped to the report-preview tables; the dashboard entry table
       * is not a PDF table and is therefore untouched.
       */
      const fitReportPreview=()=>{
        try{
          if(typeof fitAllPDFTablesInPrintWindow==="function"){
            fitAllPDFTablesInPrintWindow(window);
          }
          if(typeof syncDcbHeadersAfterFit==="function"){
            syncDcbHeadersAfterFit(window);
          }
        }catch(e){
          try{console.warn("Report preview fitting error:",e);}catch(ignore){}
        }
        preview.scrollIntoView({behavior:"smooth",block:"start"});
      };

      if(document.fonts&&document.fonts.ready){
        document.fonts.ready.then(()=>{
          requestAnimationFrame(()=>requestAnimationFrame(fitReportPreview));
        }).catch(()=>setTimeout(fitReportPreview,60));
      }else{
        setTimeout(fitReportPreview,60);
      }
    }

    function downloadAllReports(){
      const v=vo();
      if(!v){alert(`Select a ${pdfParentLabel()} first.`);return;}
      allPdfsPDF();
    }

    function downloadCurrentReport(){
      const v=vo();
      if(!v){alert(`Select a ${pdfParentLabel()} first.`);return;}
      if(currentReportType==="DCB") monthlyPDF(false);
      else if(currentReportType==="LL") ledgerPDF(false);
      else if(currentReportType==="CUMULATIVE") cumulativeDcbPDF(false);
      else alert("Show a report first, then download that report.");
    }

    /* Firebase Login / Sign Up gate.
       Mobile number + username are stored in the user's Profile only.
       No SMS/OTP is used. */
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
        return "Firebase permission denied. Please update the Firestore rules to allow users to create their own access request.";
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
      if(!["VO","MS","SHG"].includes(mode))return;
      window.selectedLoginSystem=mode;
      const voBtn=document.getElementById("loginVoBtn");
      const msBtn=document.getElementById("loginMsBtn");
      const shgBtn=document.getElementById("loginShgBtn");
      const selectedLabel=document.getElementById("selectedLoginSystem");
      if(voBtn){voBtn.classList.toggle("login-system-selected",mode==="VO");voBtn.setAttribute("aria-pressed",mode==="VO"?"true":"false");}
      if(msBtn){msBtn.classList.toggle("login-system-selected",mode==="MS");msBtn.setAttribute("aria-pressed",mode==="MS"?"true":"false");}
      if(shgBtn){shgBtn.classList.toggle("login-system-selected",mode==="SHG");shgBtn.setAttribute("aria-pressed",mode==="SHG"?"true":"false");}
      if(selectedLabel)selectedLabel.textContent=mode==="MS"?"Login to MS → VO":(mode==="SHG"?"Login to SHG → Member":"Login to VO → SHG");
      const signupSystem=document.getElementById("signupSystem");
      if(signupSystem)signupSystem.value=mode;
      const loginError=document.getElementById("loginError");
      if(loginError)loginError.textContent="";
    }

    // Expose the selector so the login page also works through the non-module
    // fallback handler below. This avoids the buttons becoming inert if the
    // browser delays module event wiring.
    window.setSelectedLoginSystem=setSelectedLoginSystem;

    async function lookupUsername(username,system=window.selectedLoginSystem){
      const key=String(username||"").trim().toLowerCase();
      const mode=String(system||"VO").toUpperCase();
      if(!key || !["VO","MS","SHG"].includes(mode))return null;
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
        MS:existingAccess.MS===true || data.system==="MS",
        SHG:existingAccess.SHG===true || data.system==="SHG"
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
      if(!["VO","MS","SHG"].includes(mode))throw new Error("Invalid registration system.");
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



    const ADMIN_USERNAME="chary";
    const ADMIN_PASSWORD="800820";
    const ADMIN_EMAIL="chary.admin@charys-dcb.local";

    function isAdminProfile(data){
      const profile=data&&data.profile||{};
      return String(profile.role||"").toLowerCase()==="admin" || String(profile.username||"").trim().toLowerCase()===ADMIN_USERNAME;
    }

    async function ensureAdminAccount(){
      let user=null;
      try{
        const cred=await window.firebaseCloud.signIn(ADMIN_EMAIL,ADMIN_PASSWORD);
        user=cred&&cred.user?cred.user:window.firebaseCloud.currentUser;
      }catch(err){
        const code=String(err&&err.code||"");
        if(code!=="auth/user-not-found" && code!=="auth/invalid-credential" && code!=="auth/invalid-login-credentials") throw err;
        const cred=await window.firebaseCloud.signUp(ADMIN_EMAIL,ADMIN_PASSWORD);
        user=cred&&cred.user?cred.user:window.firebaseCloud.currentUser;
      }
      if(!user)throw new Error("Admin account could not be loaded.");
      const ref=window.firebaseCloud.doc(window.firebaseCloud.getFirestore(),"users",user.uid);
      const snap=await window.firebaseCloud.getDoc(ref);
      const data=snap.exists()?snap.data()||{}:{};
      const access={VO:true,MS:true,SHG:true,...(data.access||{})};
      access.VO=true;access.MS=true;access.SHG=true;
      await window.firebaseCloud.setDoc(ref,{profile:{...(data.profile||{}),email:ADMIN_EMAIL,username:ADMIN_USERNAME,mobile:data.profile?.mobile||"",role:"admin"},access,updatedAt:new Date().toISOString()},{merge:true});
      await window.firebaseCloud.setDoc(window.firebaseCloud.doc(window.firebaseCloud.getFirestore(),"usernames","VO_"+ADMIN_USERNAME),{uid:user.uid,email:ADMIN_EMAIL,system:"VO"},{merge:true});
      await window.firebaseCloud.setDoc(window.firebaseCloud.doc(window.firebaseCloud.getFirestore(),"usernames","MS_"+ADMIN_USERNAME),{uid:user.uid,email:ADMIN_EMAIL,system:"MS"},{merge:true});
      await window.firebaseCloud.setDoc(window.firebaseCloud.doc(window.firebaseCloud.getFirestore(),"usernames","SHG_"+ADMIN_USERNAME),{uid:user.uid,email:ADMIN_EMAIL,system:"SHG"},{merge:true});
      return user;
    }

    async function submitAccessRequest(){
      const msg=document.getElementById("signupMsg");
      const btn=document.getElementById("signupCreateBtn");
      try{
        const data=validateAccountForm();
        if(msg){msg.textContent="Submitting access request...";msg.className="auth-msg";}
        if(btn)btn.disabled=true;
        const db=window.firebaseCloud.getFirestore();
        const mode=data.system;
        const usernameKey=String(data.username||"").trim().toLowerCase();

        // Mark this as a Request Access authentication flow BEFORE creating or
        // signing in the Firebase Auth user. onAuthStateChanged otherwise sees
        // the new user, finds no approved access yet, and immediately signs
        // the user out with "This account has no registered system access."
        // That race was leaving this modal stuck on "Submitting access request...".
        sessionStorage.setItem("accessRequestInProgress","1");

        /*
         * IMPORTANT: do not read usernames/{system}_{username} before Firebase
         * Authentication.  A newly submitting user is not authenticated yet,
         * and Firestore rules commonly allow that collection to be read only
         * after sign-in.  That was the source of the
         * "Missing or insufficient permissions" error on Request Access.
         * Authenticate first, then perform the username check.
         */
        let user=null;
        let createdNewAuthUser=false;
        try{
          const cred=await window.firebaseCloud.signUp(data.email,data.pw);
          user=cred&&cred.user?cred.user:window.firebaseCloud.currentUser;
          createdNewAuthUser=true;
        }catch(authErr){
          if(String(authErr&&authErr.code||"")==="auth/email-already-in-use"){
            const cred=await window.firebaseCloud.signIn(data.email,data.pw);
            user=cred&&cred.user?cred.user:window.firebaseCloud.currentUser;
          }else throw authErr;
        }
        if(!user)throw new Error("Account could not be loaded.");

        // Do not allow duplicate pending requests for the same Firebase user/system.
        // Rejected requests are intentionally ignored so the user can request again.
        const requestQuery=window.firebaseCloud.query(
          window.firebaseCloud.collection(db,"accessRequests"),
          window.firebaseCloud.where("uid","==",user.uid)
        );
        const requestSnap=await window.firebaseCloud.getDocs(requestQuery);
        let hasPendingRequest=false;
        let hasApprovedRequest=false;
        requestSnap.forEach(d=>{
          const r=d.data()||{};
          if(String(r.system||"").toUpperCase()!==mode)return;
          const status=String(r.status||"").toUpperCase();
          if(status==="PENDING")hasPendingRequest=true;
          if(status==="APPROVED")hasApprovedRequest=true;
        });
        if(hasPendingRequest)
          throw new Error("A pending access request already exists for "+mode+". Please wait for administrator approval.");
        if(hasApprovedRequest)
          throw new Error("This account already has approved access for "+mode+".");

        const usernameRef=window.firebaseCloud.doc(db,"usernames",mode+"_"+usernameKey);
        const usernameSnap=await window.firebaseCloud.getDoc(usernameRef);
        if(usernameSnap.exists() && String(usernameSnap.data()?.uid||"")!==String(user.uid||"")){
          if(createdNewAuthUser){
            try{await window.firebaseCloud.deleteCurrentUser();}catch(cleanupErr){console.warn("Could not remove unused Auth account:",cleanupErr);}
          }
          throw new Error("Username already exists for "+mode+". Please choose another username.");
        }

        /*
         * IMPORTANT: A new Request Access submission must not write to the
         * protected users/{uid} document. The user has not been approved yet,
         * so the only Firestore document this step creates is the user's own
         * accessRequests/{system}_{uid} request. The admin creates/updates the
         * users/{uid} access flag when approving the request.
         *
         * This also prevents a newly-created Firebase Auth account from
         * accidentally receiving access before administrator approval.
         */
        /*
         * IMPORTANT: do not read a new accessRequests/{id} document before
         * creating it. With the supplied Firestore rules, a non-existent
         * document cannot satisfy a read rule that checks resource.data.uid.
         * That read was causing "Missing or insufficient permissions" even
         * though the newly-created Auth user was already signed in.
         *
         * Create a fresh document directly. The Firestore create rule checks
         * uid == request.auth.uid, status == PENDING and a valid system.
         */
        const requestRef=window.firebaseCloud.doc(
          window.firebaseCloud.collection(db,"accessRequests")
        );

        await window.firebaseCloud.setDoc(requestRef,{
          uid:user.uid,
          name:data.name,
          email:data.email,
          mobile:data.mobile,
          username:data.username,
          system:mode,
          status:"PENDING",
          requestedAt:new Date().toISOString(),
          updatedAt:new Date().toISOString()
        },{merge:true});

        // The flag was set before authentication so the auth-state listener
        // ignored the temporary, not-yet-approved account. Now that the request
        // is safely stored, sign out and let the normal signed-out state clear
        // the flag.
        try{await window.firebaseCloud.logout();}catch(e){console.warn("Request logout failed:",e);}
        closeModal("signupModal");
        ["signupName","signupEmail","signupMobile","signupUsername","signupPassword","signupConfirm"].forEach(id=>{const el=document.getElementById(id);if(el)el.value="";});
        const sys=document.getElementById("signupSystem");if(sys)sys.value=window.selectedLoginSystem;
        if(msg){msg.textContent="Access request submitted. Please wait for administrator approval.";msg.className="auth-msg ok";}
        const loginError=document.getElementById("loginError");if(loginError)loginError.textContent="Access request submitted. Please wait for administrator approval.";
      }catch(err){
        console.error("Access request failed:",err);
        if(msg){msg.textContent=err.message||friendlyAuthError(err);msg.className="auth-msg error";}
      }finally{if(btn)btn.disabled=false;}
    }

    async function loadAdminAccessRequests(){
      const panel=document.getElementById("adminAccessPanel");
      const box=document.getElementById("adminAccessRequests");
      const msg=document.getElementById("adminAccessMsg");
      if(!panel||!box)return;
      panel.classList.remove("hidden");
      box.innerHTML="Loading requests...";
      if(msg){msg.textContent="";msg.className="auth-msg";}
      try{
        const snap=await window.firebaseCloud.getDocs(window.firebaseCloud.collection(window.firebaseCloud.getFirestore(),"accessRequests"));
        const rows=[];
        snap.forEach(d=>rows.push({id:d.id,...(d.data()||{})}));
        rows.sort((a,b)=>String(b.requestedAt||"").localeCompare(String(a.requestedAt||"")));
        if(!rows.length){box.innerHTML="No access requests found.";return;}
        box.innerHTML=rows.map(r=>{
          const status=String(r.status||"PENDING").toUpperCase();
          const safe=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
          const actions=status==="PENDING"?`<div class="auth-actions" style="margin-top:8px;"><button type="button" class="success admin-request-action" data-request-action="approve" data-request-id="${safe(r.id)}">Approve</button><button type="button" class="danger admin-request-action" data-request-action="reject" data-request-id="${safe(r.id)}">Reject</button><button type="button" class="danger admin-request-delete" data-request-id="${safe(r.id)}">Delete</button></div>`:`<div class="auth-actions" style="margin-top:8px;"><button type="button" class="danger admin-request-delete" data-request-id="${safe(r.id)}">Delete</button></div>`;
          return `<div style="border:1px solid #d5dce4;border-radius:8px;padding:10px;margin-bottom:8px;background:#fff;"><div><b>Name:</b> ${safe(r.name)}</div><div><b>Username:</b> ${safe(r.username)}</div><div><b>Email:</b> ${safe(r.email)}</div><div><b>Mobile:</b> ${safe(r.mobile)}</div><div><b>Requested Access:</b> ${safe(r.system)}</div><div><b>Status:</b> ${safe(status)}</div><div><b>Requested:</b> ${safe(r.requestedAt)}</div>${actions}</div>`;
        }).join("");
      }catch(err){
        console.error("Could not load access requests:",err);
        box.innerHTML="Unable to load access requests.";
        if(msg){msg.textContent=friendlyAuthError(err);msg.className="auth-msg error";}
      }
    }

    async function handleAdminRequestDelete(requestId){
      const msg=document.getElementById("adminAccessMsg");
      try{
        if(!requestId)throw new Error("Invalid access request.");
        if(!confirm("Delete this access request?\n\nThis removes only the access request record. The user's Firebase account and existing access are not deleted."))return;
        const db=window.firebaseCloud.getFirestore();
        const requestRef=window.firebaseCloud.doc(db,"accessRequests",requestId);
        const requestSnap=await window.firebaseCloud.getDoc(requestRef);
        if(!requestSnap.exists())throw new Error("Request no longer exists.");
        await window.firebaseCloud.deleteDoc(requestRef);
        if(msg){msg.textContent="Access request deleted.";msg.className="auth-msg ok";}
        await loadAdminAccessRequests();
      }catch(err){
        console.error("Admin request delete failed:",err);
        if(msg){msg.textContent=err.message||"Unable to delete access request.";msg.className="auth-msg error";}
      }
    }

    async function handleAdminRequestAction(requestId,action){
      const msg=document.getElementById("adminAccessMsg");
      try{
        const db=window.firebaseCloud.getFirestore();
        const requestRef=window.firebaseCloud.doc(db,"accessRequests",requestId);
        const requestSnap=await window.firebaseCloud.getDoc(requestRef);
        if(!requestSnap.exists())throw new Error("Request no longer exists.");
        const request=requestSnap.data()||{};
        if(String(request.status||"").toUpperCase()!=="PENDING")throw new Error("This request has already been processed.");
        if(action==="reject"){
          await window.firebaseCloud.setDoc(requestRef,{status:"REJECTED",updatedAt:new Date().toISOString()},{merge:true});
        }else if(action==="approve"){
          const mode=String(request.system||"").toUpperCase();
          if(!["VO","MS","SHG"].includes(mode))throw new Error("Invalid requested system.");
          await reserveUsername(request.uid,request.email,request.username,mode);
          const userRef=window.firebaseCloud.doc(db,"users",request.uid);
          const userSnap=await window.firebaseCloud.getDoc(userRef);
          const data=userSnap.exists()?userSnap.data()||{}:{};
          const access={VO:false,MS:false,SHG:false,...(data.access||{})};
          access[mode]=true;
          await window.firebaseCloud.setDoc(userRef,{profile:{...(data.profile||{}),name:request.name||data.profile?.name||"",email:request.email,mobile:request.mobile||data.profile?.mobile||"",username:request.username},access,updatedAt:new Date().toISOString()},{merge:true});
          await window.firebaseCloud.setDoc(requestRef,{status:"APPROVED",approvedBy:window.firebaseCloud.currentUser?.uid||"",approvedAt:new Date().toISOString(),updatedAt:new Date().toISOString()},{merge:true});
        }
        if(msg){msg.textContent=action==="approve"?"Access request approved.":"Access request rejected.";msg.className="auth-msg ok";}
        await loadAdminAccessRequests();
      }catch(err){
        console.error("Admin request action failed:",err);
        if(msg){msg.textContent=err.message||"Unable to process request.";msg.className="auth-msg error";}
      }
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
        if(identifier.trim().toLowerCase()===ADMIN_USERNAME && password===ADMIN_PASSWORD){
          await ensureAdminAccount();
          return;
        }
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

    window.attemptLogin=attemptLogin;

    // Expose auth actions for the independent fallback wiring at the bottom.
    window.attemptSignUp=submitAccessRequest;
    window.sendEmailReset=sendEmailReset;

    function openModal(id){
      const el=document.getElementById(id);
      if(el)el.classList.remove("hidden");
    }

    function closeModal(id){
      const el=document.getElementById(id);
      if(el)el.classList.add("hidden");
    }

    window.openAuthModal=openModal;
    window.closeAuthModal=closeModal;

    function validateAccountForm(){
      const name=document.getElementById("signupName").value.trim();
      const email=document.getElementById("signupEmail").value.trim();
      const mobile=normalizePhone(document.getElementById("signupMobile").value);
      const username=document.getElementById("signupUsername").value.trim();
      const pw=document.getElementById("signupPassword").value;
      const cp=document.getElementById("signupConfirm").value;
      const system=(document.getElementById("signupSystem")?.value||"VO").toUpperCase();

      if(!name||!email||!mobile||!username||!pw||!cp)
        throw new Error("Fill all required fields.");
      if(name.length<2||name.length>80)
        throw new Error("Name must be 2-80 characters.");
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

      if(!["VO","MS","SHG"].includes(system)) throw new Error("Select a valid registration system.");
      return {name,email,mobile,username,pw,system};
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
        const access=data.access||{VO:true,MS:false,SHG:false};
        const adminPanel=document.getElementById("adminAccessPanel");
        if(adminPanel){
          if(isAdminProfile(data)) await loadAdminAccessRequests();
          else adminPanel.classList.add("hidden");
        }

        if(summary){
          summary.innerHTML=
            "<div><b>Email:</b> "+String(profile.email||user.email||"")+"</div>"+
            "<div><b>Username:</b> "+String(profile.username||"")+"</div>";
        }
        if(mobileInput)mobileInput.value=profile.mobile||"";
        const accessSummary=document.getElementById("profileAccessSummary");
        if(accessSummary)accessSummary.innerHTML=
          `<div><b>VO Access:</b> ${access.VO===true?"Registered":"Not registered"}</div>`+
          `<div><b>MS Access:</b> ${access.MS===true?"Registered":"Not registered"}</div>`+
          `<div><b>SHG Access:</b> ${access.SHG===true?"Registered":"Not registered"}</div>`;
        const rv=document.getElementById("registerVOAccessBtn"), rm=document.getElementById("registerMSAccessBtn"), rs=document.getElementById("registerSHGAccessBtn");
        if(rv){rv.disabled=access.VO===true;rv.textContent=access.VO===true?"VO Registered":"Register for VO";}
        if(rm){rm.disabled=access.MS===true;rm.textContent=access.MS===true?"MS Registered":"Register for MS";}
        if(rs){rs.disabled=access.SHG===true;rs.textContent=access.SHG===true?"SHG Registered":"Register for SHG";}
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

        // Tell the auth-state flow which system a brand-new account is being
        // registered for. This keeps VO, MS and SHG creation symmetrical.
        sessionStorage.setItem("pendingRegistrationSystem",data.system);

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

    // Bind login controls defensively. The delegated fallback below also
    // handles clicks if a browser loads the module after the page markup.
    const loginVoBtnEl=document.getElementById("loginVoBtn");
    const loginMsBtnEl=document.getElementById("loginMsBtn");
    const loginShgBtnEl=document.getElementById("loginShgBtn");
    if(loginVoBtnEl)loginVoBtnEl.onclick=()=>setSelectedLoginSystem("VO");
    if(loginMsBtnEl)loginMsBtnEl.onclick=()=>setSelectedLoginSystem("MS");
    if(loginShgBtnEl)loginShgBtnEl.onclick=()=>setSelectedLoginSystem("SHG");
    // Initial state: VO is selected and therefore BLUE.
    setSelectedLoginSystem(window.selectedLoginSystem);

    const loginBtnEl=document.getElementById("loginBtn");
    if(loginBtnEl)loginBtnEl.onclick=attemptLogin;
    document.getElementById("signUpBtn").onclick=()=>{
      const msg=document.getElementById("signupMsg");
      if(msg){msg.textContent="";msg.className="auth-msg";}
      const sys=document.getElementById("signupSystem"); if(sys)sys.value=window.selectedLoginSystem;
      openModal("signupModal");
    };
    document.getElementById("signupCreateBtn").onclick=submitAccessRequest;
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

        const db=window.firebaseCloud.getFirestore();
        /*
         * Do not read a new accessRequests document here. The Firestore rules
         * allow the signed-in user to create the request, but a getDoc() on a
         * non-existent document can fail when the read rule references
         * resource.data. Create the request directly instead.
         */
        const requestQuery=window.firebaseCloud.query(
          window.firebaseCloud.collection(db,"accessRequests"),
          window.firebaseCloud.where("uid","==",user.uid)
        );
        const requestSnap=await window.firebaseCloud.getDocs(requestQuery);
        let hasPendingRequest=false;
        let hasApprovedRequest=!!data.access?.[mode];
        requestSnap.forEach(d=>{
          const r=d.data()||{};
          if(String(r.system||"").toUpperCase()!==mode)return;
          const status=String(r.status||"").toUpperCase();
          if(status==="PENDING")hasPendingRequest=true;
          if(status==="APPROVED")hasApprovedRequest=true;
        });
        if(hasPendingRequest)throw new Error(`A pending ${mode} access request already exists. Please wait for administrator approval.`);
        if(hasApprovedRequest)throw new Error(`This account already has approved access for ${mode}.`);

        const requestRef=window.firebaseCloud.doc(
          window.firebaseCloud.collection(db,"accessRequests")
        );

        // Do not grant or reserve access here. The administrator will do that
        // after approving the request.
        await window.firebaseCloud.setDoc(requestRef,{
          uid:user.uid,
          name:profile.name||"",
          email,
          mobile:profile.mobile||"",
          username,
          system:mode,
          status:"PENDING",
          requestedAt:new Date().toISOString(),
          updatedAt:new Date().toISOString()
        },{merge:true});

        if(msg){msg.textContent=`${mode} access request submitted. Please wait for administrator approval.`;msg.className="auth-msg ok";}
        await openProfile();
      }catch(err){
        if(msg){msg.textContent=err.message||"Registration failed.";msg.className="auth-msg error";}
      }
    }

    document.addEventListener("click",function(e){
      const deleteBtn=e.target.closest(".admin-request-delete");
      if(deleteBtn){
        e.preventDefault();
        handleAdminRequestDelete(deleteBtn.dataset.requestId);
        return;
      }
      const adminBtn=e.target.closest(".admin-request-action");
      if(!adminBtn)return;
      e.preventDefault();
      handleAdminRequestAction(adminBtn.dataset.requestId,adminBtn.dataset.requestAction);
    });

    const profileBtnEl=document.getElementById("profileBtn");
    if(profileBtnEl)profileBtnEl.onclick=openProfile;
    document.getElementById("registerVOAccessBtn")?.addEventListener("click",()=>registerOtherSystem("VO"));
    document.getElementById("registerMSAccessBtn")?.addEventListener("click",()=>registerOtherSystem("MS"));
    document.getElementById("registerSHGAccessBtn")?.addEventListener("click",()=>registerOtherSystem("SHG"));

    const saveProfileMobileBtn=document.getElementById("saveProfileMobileBtn");
    if(saveProfileMobileBtn)saveProfileMobileBtn.onclick=saveProfileMobile;

    const changePasswordBtn=document.getElementById("changePasswordBtn");
    if(changePasswordBtn)changePasswordBtn.onclick=changeProfilePassword;


    loginUsername.onkeydown=e=>{
      if(e.key==="Enter"){e.preventDefault();loginPassword.focus();}
    };
    loginPassword.onkeydown=e=>{
      if(e.key==="Enter"){e.preventDefault();attemptLogin();}
    };

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
      const fy=document.getElementById("newFinancialYear");
      if(fy)fy.value="";
      document.getElementById("newVoName").focus();
    };

    // Both Create New VO buttons use the same handler.
    // The Home-page button was previously missing its click binding.
    const homeNewVoBtn=document.getElementById("homeNewVoBtn");
    if(homeNewVoBtn)homeNewVoBtn.onclick=openNewVoForm;

    document.getElementById("cancelVoBtn").onclick=()=>{
      document.getElementById("newVoForm").classList.add("hidden");
      const fy=document.getElementById("newFinancialYear");
      if(fy)fy.value="";
    };
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
    document.getElementById("saveVoBtn").onclick=()=>{
      try{saveVO();}
      catch(err){console.error("Save All Parent failed:",err);alert("Could not save all parent details. Please check the required fields and try again.");}
    };
    document.getElementById("addShgBtn").onclick=addSHG;
    document.getElementById("shgNameInput").onkeydown=e=>{if(e.key==="Enter"){e.preventDefault();addSHG();}};
    document.getElementById("loanTypeFilter").onchange=e=>{
      if(dirty&&!saveCurrentScreen()){e.target.value=selectedLoanType;return;}
      selectedLoanType=e.target.value||defaultLoanTypeKey();
      refreshLoanInterestRateInput();
      renderRows();
      markClean();
    };
    document.getElementById("memberFilter").onchange=e=>{
      if(dirty&&!saveCurrentScreen()){e.target.value=selectedMemberId;return;}
      selectedMemberId=e.target.value||"ALL";
      renderRows();
      markClean();
    };
    document.getElementById("saveAllBtn").onclick=async()=>{
      try{await saveAll();}
      catch(err){
        console.error("Save All Children failed:",err);
        const msg=describeCloudSaveError(err);
        const status=document.getElementById("saveStatus");
        if(status)status.textContent="Save failed: "+msg;
        alert("Could not save all child records.\n\n"+msg);
      }
    };
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
    document.getElementById("showReportsBtn").onclick=toggleReportCenter;
    const reportsNavBtn=document.getElementById("reportsNavBtn");
    if(reportsNavBtn)reportsNavBtn.onclick=()=>{
      const reportSection=document.getElementById("reportCenterSection");
      const toggle=document.getElementById("showReportsBtn");
      if(reportSection && reportSection.classList.contains("hidden") && toggle) toggle.click();
      setTimeout(()=>document.getElementById("reportCenterSection")?.scrollIntoView({behavior:"smooth",block:"start"}),50);
    };
    document.getElementById("closeReportsBtn").onclick=closeReportCenter;
    document.getElementById("showDcbReportBtn").onclick=()=>showReportInUi("DCB");
    document.getElementById("showLedgerReportBtn").onclick=()=>showReportInUi("LL");
    document.getElementById("showCumulativeReportBtn").onclick=()=>showReportInUi("CUMULATIVE");
    document.getElementById("downloadAllReportsBtn")?.addEventListener("click",downloadAllReports);
    document.getElementById("downloadCurrentReportBtn")?.addEventListener("click",downloadCurrentReport);
    document.getElementById("reportMemberFilter").onchange=e=>{
      reportPreviewMemberId=e.target.value||"ALL";
      if(currentReportType)showReportInUi(currentReportType);
    };
    document.getElementById("reportLoanFilter").onchange=e=>{
      reportPreviewLoanType=e.target.value||"bankLinkage";
      if(currentReportType)showReportInUi(currentReportType);
    };
    document.getElementById("reportMonthFilter").onchange=e=>{
      reportPreviewMonth=e.target.value||"ALL";
      if(currentReportType==="DCB")showReportInUi("DCB");
    };
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
    })();
/* =========================================================
   ENTER KEY = NEXT ROW, SAME COLUMN
   ---------------------------------------------------------
   - Tab keeps its normal browser behavior.
   - Enter moves to the next visible row.
   - The column stays the same.
   - Works with dynamically-created table rows.
   - Does not change calculations, saving, PDF, filters, etc.
   ========================================================= */

document.addEventListener("keydown", function(e) {
  if (e.key !== "Enter") return;

  const current = e.target;

  /* Only handle inputs/selects inside the accounting table. */
  if (!current.closest("#entryBody")) return;

  /* Do not interfere with textarea elements if any are added later. */
  if (current.tagName === "TEXTAREA") return;

  e.preventDefault();

  const currentCell = current.closest("td");
  const currentRow = current.closest("tr");

  if (!currentCell || !currentRow) return;

  /* Find the column number of the current cell. */
  const cells = Array.from(currentRow.children);
  const columnIndex = cells.indexOf(currentCell);

  if (columnIndex < 0) return;

  /* Find the next actual data row. */
  let nextRow = currentRow.nextElementSibling;

  while (nextRow) {
    const nextCell = nextRow.children[columnIndex];

    if (nextCell) {
      /*
       * Find the first usable form control in the same column.
       * Disabled calculated cells are skipped automatically.
       */
      const nextControl = nextCell.querySelector(
        "input:not([disabled]), select:not([disabled]), textarea:not([disabled])"
      );

      if (nextControl) {
        nextControl.focus();

        /* Select existing numeric/text value for quick replacement. */
        if (
          nextControl.tagName === "INPUT" &&
          nextControl.type !== "button" &&
          nextControl.type !== "submit"
        ) {
          try {
            nextControl.select();
          } catch (_) {}
        }

        return;
      }
    }

    nextRow = nextRow.nextElementSibling;
  }
});
