"use strict";

/* =========================================================
   ACCOUNTING CORE
   Shared VO/MS state, CRUD, calculations, SHG/VO table rendering,
   backup/restore, and Firebase-cloud synchronization bridge.
   PDF generation and authentication are in separate files.
   ========================================================= */
let currentMode = "VO";
    const MONTHS=[["Apr-26","April-2026"],["May-26","May-2026"],["Jun-26","June-2026"],["Jul-26","July-2026"],["Aug-26","August-2026"],["Sep-26","September-2026"],["Oct-26","October-2026"],["Nov-26","November-2026"],["Dec-26","December-2026"],["Jan-27","January-2027"],["Feb-27","February-2027"],["Mar-27","March-2027"]];
    let db=readDb(), selectedVOId=null, monthIndex=0, dirty=false;
    window.addEventListener("firebase-cloud-ready",function(e){
      currentMode=(e.detail&&e.detail.mode)||currentMode||"VO";
      const cloudDb=e.detail&&e.detail.db;
      db=(cloudDb&&Array.isArray(cloudDb.vos))?cloudDb:{vos:[]};
      localStorage.setItem(modeKey(),JSON.stringify(db));
      applyAccountingLabels();
      selectedVOId=null;
      monthIndex=0;
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
      const name=document.getElementById("voName").value.trim(),village=document.getElementById("village").value.trim(),mandal=document.getElementById("mandal").value.trim();
      if(!name){alert(`${modeConfig().parent} Name is required.`);document.getElementById("voName").focus();return false;}
      if(currentMode!=="MS" && !village){alert("Village is required.");document.getElementById("village").focus();return false;}
      if(!mandal){alert("Mandal is required.");document.getElementById("mandal").focus();return false;}
      const district=document.getElementById("district").value.trim();
      if(currentMode==="MS" && !district){alert("District is required for MS.");document.getElementById("district").focus();return false;}
      v.name=name;v.village=village;v.mandal=mandal;v.district=district;

      const rateInput=document.getElementById("shgRateInput");
      const currentRate=rateInput?Number(rateInput.value):12;
      if(!Number.isFinite(currentRate)||currentRate<0||currentRate>100){alert("Enter a valid interest rate between 0 and 100%.");if(rateInput)rateInput.focus();return false;}
      v.interestRate=currentRate;
      v.shgs.forEach((s,i)=>{
        const startIdx=Number.isInteger(s.startMonthIndex)?s.startMonthIndex:0;
        if(monthIndex<startIdx)return;

        const n=document.getElementById("name-"+i);if(n&&n.value.trim())s.name=n.value.trim();
        s.interestRate=currentRate;
        const key=MONTHS[monthIndex][0];
        const raw=getRowData(i);
        const april=(monthIndex===0);
        const creationMonth=(monthIndex===startIdx && startIdx>0);
        const nextMonthStart=(monthIndex===startIdx+1 && startIdx>0);

        if(april){
          /* April SHGs use the original fully-editable starting fields. */
        }else if(creationMonth){
          /* Creation month for a mid-year SHG: ONLY New Loan is enabled.
           * Opening/previous due/demand and both collection fields are disabled.
           * Therefore no collection can be entered in the creation month. */
          raw.opening=0;
          raw.prevPrincipal=0;
          raw.prevInterest=0;
          raw.demandPrincipal=0;
          raw.principalCollection="";
          raw.interestCollection="";
        }else if(nextMonthStart){
          /* The month after creation is the SHG's first full accounting month.
           * Its starting fields are enabled like April, but are prefilled from
           * the creation month's closing/due values and may be edited. */
          const prev=lastConsideredMonth(s,monthIndex);
          if(prev){
            const pc=calc(prev.data);
            raw.opening=pc.totalLoanBalance;
            raw.prevPrincipal=pc.balancePrincipal;
            raw.prevInterest=pc.balanceInterest;
          }
        }else{
          const prev=lastConsideredMonth(s,monthIndex);
          const pc=prev?calc(prev.data):null;
          if(pc){
            raw.opening=pc.totalLoanBalance;
            raw.prevPrincipal=pc.balancePrincipal;
            raw.prevInterest=pc.balanceInterest;
          }
          /* IMPORTANT: preserve this month's edited Current Month Principal.
           * It is initialized from the previous month only when this month
           * has no saved value; once edited, the edited value is saved here. */
        }
        raw.demandInterest=monthlyInterest(raw.opening,s.interestRate);

        if(monthIsConsidered(raw)) s.months[key]=raw;
        else if(s.months[key]) delete s.months[key];
      });
      writeDb();refreshVOSelect();markClean();document.getElementById("saveStatus").textContent="Saved";return true;
    }

    function confirmSwitch(action){
      if(!dirty)return true;
      const proceed=confirm(
        "You have unsaved changes.\n\n" +
        "Press OK to continue without saving, or Cancel and save the VO details."
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

    function blank(){return{opening:0,prevPrincipal:0,prevInterest:0,demandPrincipal:0,demandInterest:0,principalCollection:"",interestCollection:"",newLoan:0};}
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

      return principalEntered || interestEntered;
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
     if(v && (v.interestRate===undefined||v.interestRate===null) && v.shgs.length) v.interestRate=Number(v.shgs[0].interestRate||12);
     dash.classList.toggle("hidden",!v);
     if(!v)return;
     document.getElementById("voName").value=v.name;
     document.getElementById("village").value=v.village||"";
     document.getElementById("mandal").value=v.mandal||"";
     document.getElementById("district").value=v.district||"";
     const rateInput=document.getElementById("shgRateInput");
     if(rateInput) rateInput.value=(v.interestRate!==undefined&&v.interestRate!==null)?v.interestRate:(v.shgs[0]&&v.shgs[0].interestRate!==undefined?v.shgs[0].interestRate:12);
     renderMonths();renderRows();
    }

    function goHome(){
      if(!confirmSwitch("returning to the initial page"))return;
      selectedVOId=null;
      monthIndex=0;
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
      if(!name){alert(`Enter a ${modeConfig().parent} name.`);return;}
      if(db.vos.some(x=>String(x.name||"").trim().toLowerCase()===name.toLowerCase())){alert(`A ${modeConfig().parent} with this name already exists. Select it from the dropdown.`);return;}
      const v={id:"VO-"+Date.now()+"-"+Math.random().toString(36).slice(2),name:name,village:"",mandal:"",district:"",shgs:[]};
      db.vos.push(v);selectedVOId=v.id;monthIndex=0;
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
      setTimeout(()=>document.getElementById(currentMode==="MS"?"mandal":"village").focus(),50);
    }

    function updateInterestRateLive(){
      const v=vo(),el=document.getElementById("shgRateInput");if(!v||!el)return;
      const rate=Number(el.value);
      if(!Number.isFinite(rate)||rate<0||rate>100)return;
      v.interestRate=rate;v.shgs.forEach(s=>s.interestRate=rate);
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
      v.shgs.push({id:"SHG-"+Date.now()+"-"+Math.random().toString(36).slice(2),name:name,interestRate:rate,startMonthIndex:monthIndex,months:{}});
      input.value="";v.interestRate=rate;markDirty();renderRows();
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
      return {opening:vals.opening,prevPrincipal:vals.prevP,prevInterest:vals.prevI,demandPrincipal:vals.demandP,demandInterest:vals.demandI,
        principalCollection:cp?String(cp.value).trim():"",interestCollection:ci?String(ci.value).trim():"",newLoan:vals.newLoan};
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
     const april=(monthIndex===0);
     v.shgs.forEach((s,i)=>{
      if(s.interestRate===undefined||s.interestRate===null||s.interestRate==="")s.interestRate=12;
      const startIdx=Number.isInteger(s.startMonthIndex)?s.startMonthIndex:0;
      if(monthIndex<startIdx)return;
      const key=MONTHS[monthIndex][0],saved=s.months[key],d=saved||blank();
      if(!saved&&monthIndex===0){d.principalCollection=0;d.interestCollection=0;}

      /* April-created SHGs start in April. A mid-year SHG has a special
       * creation month: only New Loan is enabled there (collections remain
       * editable for same-month repayment). The following month is the first
       * full starting month and its starting fields are enabled like April.
       * From the month after that, values are derived from the SHG's own
       * history. Earlier months are not rendered and need no data. */
      let opening=d.opening, prevP=d.prevPrincipal, prevI=d.prevInterest;
      /* Current Month Principal is initialized from the immediately previous
       * month's saved Current Month Principal, but once this month has its
       * own saved value, that value remains editable and must be preserved. */
      let demandP=hasValue(saved&&saved.demandPrincipal)
        ? Number(saved.demandPrincipal)||0
        : (monthIndex>0 ? previousMonthDemandPrincipal(s,monthIndex) : Number(d.demandPrincipal)||0);
      const creationMonth=(!april && monthIndex===startIdx && startIdx>0);
      const nextMonthStart=(!april && monthIndex===startIdx+1 && startIdx>0);
      if(creationMonth){
        opening=0;prevP=0;prevI=0;demandP=0;
        d.principalCollection="";d.interestCollection="";
      }else if(nextMonthStart){
        const prev=lastConsideredMonth(s,monthIndex);
        if(prev){
          const pc=calc(prev.data);
          opening=pc.totalLoanBalance;
          prevP=pc.balancePrincipal;
          prevI=pc.balanceInterest;
        }
      }else if(!april){
        const prev=lastConsideredMonth(s,monthIndex);
        if(prev){
          const pc=calc(prev.data);
          opening=pc.totalLoanBalance;
          prevP=pc.balancePrincipal;
          prevI=pc.balanceInterest;
        }
        /* Current Month Principal is the value entered for this month.
         * Do not replace it with another month's value. */
      }
      // This Month Interest is always calculated from Opening Loan Balance and the SHG rate.
      const demandI=monthlyInterest(opening,s.interestRate);
      const c=calc({opening,prevPrincipal:prevP,prevInterest:prevI,demandPrincipal:demandP,demandInterest:demandI,principalCollection:d.principalCollection,interestCollection:d.interestCollection,newLoan:d.newLoan});
      const totalDemandP=prevP+demandP;
      const totalDemandI=prevI+demandI;

      const locked=(x)=>x?' disabled':'';
      /* Mid-year creation month: ONLY New Loan is enabled.
       * Following month: Opening/Previous Due Principal/Previous Due Interest
       * stay locked; demand principal, collections and New Loan are editable. */
      const lockName=false;
      const lockOpening=creationMonth||nextMonthStart;
      const lockPrevP=creationMonth||nextMonthStart;
      const lockPrevI=creationMonth||nextMonthStart;
      const lockDemandP=creationMonth;
      const lockCollect=creationMonth;
      const tr=document.createElement("tr");tr.id="row-"+i;
      tr.innerHTML=
      '<td>'+(i+1)+'</td>'+
      '<td><input class="name" id="name-'+i+'" value="'+esc(s.name)+'"'+locked(lockName)+'></td>'+
      '<td><input type="number" id="opening-'+i+'" value="'+opening+'"'+locked(lockOpening)+' oninput="window.recalc('+i+')"></td>'+
      '<td><input type="number" id="prevP-'+i+'" value="'+prevP+'"'+locked(lockPrevP)+' oninput="window.recalc('+i+')"></td>'+
      '<td><input type="number" id="prevI-'+i+'" value="'+prevI+'"'+locked(lockPrevI)+' oninput="window.recalc('+i+')"></td>'+
      '<td><input type="number" id="demandP-'+i+'" value="'+demandP+'"'+locked(lockDemandP)+' oninput="window.recalc('+i+')"></td>'+
      '<td><input type="number" id="demandI-'+i+'" value="'+demandI+'" disabled></td>'+
      '<td><input type="number" id="totalDP-'+i+'" value="'+totalDemandP+'" disabled></td>'+
      '<td><input type="number" id="totalDI-'+i+'" value="'+totalDemandI+'" disabled></td>'+
      '<td><input type="number" id="collectP-'+i+'" value="'+d.principalCollection+'"'+locked(lockCollect)+' oninput="window.recalc('+i+')"></td>'+
      '<td><input type="number" id="collectI-'+i+'" value="'+d.interestCollection+'"'+locked(lockCollect)+' oninput="window.recalc('+i+')"></td>'+
      '<td><input type="number" id="newLoan-'+i+'" value="'+d.newLoan+'" oninput="window.recalc('+i+')"></td>'+

      '<td class="calc" id="totalL-'+i+'">'+fmt(c.totalLoanBalance)+'</td>'+
      '<td><button type="button" class="success" onclick="window.saveRow('+i+')">Save</button></td>'+
      '<td><button type="button" class="danger shg-delete-btn" onclick="window.deleteSHG('+i+')">Delete</button></td>';
      body.appendChild(tr);
     });
     fitShgNameColumn();
     if(!v.shgs.length)body.innerHTML='<tr><td colspan="17" style="text-align:center;padding:22px">No SHGs. Add the first SHG above.</td></tr>';
    }

    window.recalc=function(i){
     const v=vo();if(!v)return;
     const d=getRowData(i);
     const rateEl=document.getElementById("shgRateInput");
     const liveRate=rateEl?Number(rateEl.value):Number(v.interestRate!==undefined?v.interestRate:(v.shgs[i].interestRate||0));
     const rate=Number.isFinite(liveRate)&&liveRate>=0?liveRate:0;
     if(Number.isFinite(liveRate)&&liveRate>=0&&liveRate<=100){v.interestRate=liveRate;v.shgs.forEach(s=>s.interestRate=liveRate);}
     markDirty();
     const april=(monthIndex===0);
     const startIdx=Number.isInteger(v.shgs[i].startMonthIndex)?v.shgs[i].startMonthIndex:0;
     const creationMonth=(!april && monthIndex===startIdx && startIdx>0);
     const nextMonthStart=(!april && monthIndex===startIdx+1 && startIdx>0);
     let prevP=d.prevPrincipal,prevI=d.prevInterest;
     let demandP=d.demandPrincipal;
     let opening=d.opening;

     if(creationMonth){
       opening=0;prevP=0;prevI=0;demandP=0;
       d.principalCollection="";d.interestCollection="";
     }else if(nextMonthStart){
       const prev=safePrevMonth(v.shgs[i],monthIndex);
       if(prev){const pc=calc(prev);opening=pc.totalLoanBalance;prevP=pc.balancePrincipal;prevI=pc.balanceInterest;}
     }else if(!april){
       const prev=safePrevMonth(v.shgs[i],monthIndex);
       if(prev){const pc=calc(prev);opening=pc.totalLoanBalance;prevP=pc.balancePrincipal;prevI=pc.balanceInterest;}
       /* Keep this month's entered Current Month Principal. */
     }
     const demandI=monthlyInterest(opening,rate);
     const interestEl=document.getElementById("demandI-"+i);
     if(interestEl)interestEl.value=demandI;
     const totalDP=prevP+demandP,totalDI=prevI+demandI;
     const c=calc({...d,opening,prevPrincipal:prevP,prevInterest:prevI,demandPrincipal:demandP,demandInterest:demandI});
     const ids=[["totalDP",totalDP],["totalDI",totalDI],["balP",c.balancePrincipal],["balI",c.balanceInterest],["totalC",c.totalCollection],["totalL",c.totalLoanBalance]];
     ids.forEach(([id,val])=>{
        const el=document.getElementById(id+"-"+i);
        if(el){
          if(el.tagName==="INPUT") el.value=Number(val||0);
          else el.textContent=fmt(val);
        }
      });
    }
    function previousMonthDemandPrincipal(shg,idx){
     if(!shg||idx<=0||!shg.months)return 0;
     const prev=shg.months[MONTHS[idx-1][0]];
     return prev && hasValue(prev.demandPrincipal) ? Number(prev.demandPrincipal)||0 : 0;
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
      writeDb();
      markClean();
      renderRows();
      document.getElementById("saveStatus").textContent="Deleted "+name;
    };

    function saveVisibleNamesOnly(){const v=vo();if(!v)return;v.shgs.forEach((s,i)=>{const startIdx=Number.isInteger(s.startMonthIndex)?s.startMonthIndex:0;if(monthIndex<startIdx)return;const n=document.getElementById("name-"+i);if(n&&n.value.trim())s.name=n.value.trim();});writeDb();}
    window.saveRow=function(i){
     const v=vo();if(!v)return;
     const s=v.shgs[i],name=document.getElementById("name-"+i).value.trim();
     const startIdx=Number.isInteger(s.startMonthIndex)?s.startMonthIndex:0;
     const april=(monthIndex===0);
     if(!name){alert(`${modeConfig().child} name cannot be blank.`);return;}
     const rateEl=document.getElementById("shgRateInput"),rate=rateEl?Number(rateEl.value):Number(v.interestRate!==undefined?v.interestRate:(s.interestRate||0));
     if(!Number.isFinite(rate)||rate<0||rate>100){alert("Enter a valid interest rate between 0 and 100%.");if(rateEl)rateEl.focus();return;}
     v.interestRate=rate;v.shgs.forEach(x=>x.interestRate=rate);
     if(monthIndex<startIdx){alert(`This ${modeConfig().child} was created in ${MONTHS[startIdx][1]}. Previous months do not require data.`);return;}
     const raw=getRowData(i);
     const creationMonth=(!april && monthIndex===startIdx && startIdx>0);
     const nextMonthStart=(!april && monthIndex===startIdx+1 && startIdx>0);
     if(creationMonth){
       raw.opening=0;raw.prevPrincipal=0;raw.prevInterest=0;raw.demandPrincipal=0;
       raw.principalCollection="";raw.interestCollection="";
     }else if(nextMonthStart){
       const prev=lastConsideredMonth(s,monthIndex);
       const pc=prev?calc(prev.data):null;
       if(pc){raw.opening=pc.totalLoanBalance;raw.prevPrincipal=pc.balancePrincipal;raw.prevInterest=pc.balanceInterest;}
     }else if(!april){
       const prev=lastConsideredMonth(s,monthIndex);
       const pc=prev?calc(prev.data):null;
       if(pc){raw.opening=pc.totalLoanBalance;raw.prevPrincipal=pc.balancePrincipal;raw.prevInterest=pc.balanceInterest;}
       /* IMPORTANT: keep this month's edited Current Month Principal.
        * The next month will inherit this saved value. */
     }
     // Always calculate this month's interest from the effective opening balance.
     raw.demandInterest=monthlyInterest(raw.opening,s.interestRate);
     s.name=name;
     if(monthIsConsidered(raw)) s.months[MONTHS[monthIndex][0]]=raw;
     else if(s.months[MONTHS[monthIndex][0]]) delete s.months[MONTHS[monthIndex][0]];
     writeDb();markClean();
     document.getElementById("saveStatus").textContent="Saved "+name+" – "+MONTHS[monthIndex][0];
    }

    window.removeSHG=function(i){
      const v=vo();if(!v||!v.shgs[i])return;
      const name=v.shgs[i].name||(modeConfig().child+" "+(i+1));
      if(!confirm('Remove '+modeConfig().child+' "'+name+'"?\n\nAll monthly data for this '+modeConfig().child+' will be deleted from this '+modeConfig().parent+'.'))return;
      v.shgs.splice(i,1);
      writeDb();
      markDirty();
      renderRows();
      document.getElementById("saveStatus").textContent=`${modeConfig().child} removed — save to keep changes`;
    };

    function saveAll(){
      const v=vo();
      if(!v)return;

      /* First capture whatever is currently being edited on screen. */
      if(!saveCurrentScreen())return;

      const rateInput=document.getElementById("shgRateInput");
      const rate=rateInput?Number(rateInput.value):Number(v.interestRate||12);
      if(!Number.isFinite(rate)||rate<0||rate>100){
        alert("Enter a valid interest rate between 0 and 100%.");
        if(rateInput)rateInput.focus();
        return;
      }

      v.interestRate=rate;

      /*
       * Persist/refresh every already-entered month for every SHG.
       * Months are stored independently, while May-27 onward derived
       * values are recalculated from the previous month's saved data.
       * This makes Save All SHGs an actual all-month save operation.
       */
      v.shgs.forEach(s=>{
        s.interestRate=rate;
        if(!s.months)s.months={};

        MONTHS.forEach((m,mi)=>{
          const key=m[0];
          const existing=s.months[key];
          if(!existing)return; // Do not create empty month records.

          const d={...blank(),...existing};

          const startIdx=Number.isInteger(s.startMonthIndex)?s.startMonthIndex:0;
          if(mi<startIdx)return;

          const creationMonth=(startIdx>0 && mi===startIdx);
          const nextMonthStart=(startIdx>0 && mi===startIdx+1);

          if(creationMonth){
            /* Creation month: only New Loan is allowed. Collections and all
             * starting/demand fields remain empty/derived as zero. */
            d.opening=0;
            d.prevPrincipal=0;
            d.prevInterest=0;
            d.demandPrincipal=0;
            d.principalCollection="";
            d.interestCollection="";
          }else if(mi>0){
            const prev=lastConsideredMonth(s,mi);
            if(prev){
              const pc=calc(prev.data);
              d.opening=pc.totalLoanBalance;
              d.prevPrincipal=pc.balancePrincipal;
              d.prevInterest=pc.balanceInterest;
            }

            if(!nextMonthStart){
              /* IMPORTANT: keep this month's own saved/edited Current Month
               * Principal. Never overwrite it while saving all months. */
            }
          }

          d.demandInterest=monthlyInterest(d.opening,rate);
          if(monthIsConsidered(d)) s.months[key]=d;
          else delete s.months[key];
        });
      });

      writeDb();
      refreshVOSelect();
      markClean();
      document.getElementById("saveStatus").textContent="All entered months saved";
      alert(`All ${modeConfig().childPlural} and all entered months have been saved.`);
    }

    function saveVO(){
      const v=vo();if(!v)return;
      const name=document.getElementById("voName").value.trim();
      const village=document.getElementById("village").value.trim();
      const mandal=document.getElementById("mandal").value.trim();
      if(!name){alert(`${modeConfig().parent} Name is required.`);document.getElementById("voName").focus();return;}
      if(currentMode!=="MS" && !village){alert("Village is required.");document.getElementById("village").focus();return;}
      if(!mandal){alert("Mandal is required.");document.getElementById("mandal").focus();return;}
      const district=document.getElementById("district").value.trim();
      if(currentMode==="MS" && !district){alert("District is required for MS.");document.getElementById("district").focus();return;}

      /*
       * Save VO must perform the same complete save as "Save All SHGs".
       * saveAll() first captures the current SHG/month from the screen and
       * then persists every entered month for every SHG in this VO.
       * No calculation logic is changed here.
       */
      v.name=name;
      v.village=village;
      v.mandal=mandal;
      v.district=district;

      saveAll();
    }

    function exportBackup(){
      const blob=new Blob([JSON.stringify(db,null,2)],{type:"application/json"}),
            u=URL.createObjectURL(blob),
            a=document.createElement("a");
      a.href=u;
      a.download=(currentMode==="MS"?"ms-vo-backup.json":"vo-shg-backup.json");
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
        alert("Please select a VO first.");
        return;
      }

      if(prompt("Type DELETE to delete the currently selected VO.")==="DELETE"){
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
