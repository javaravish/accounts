(function(){
"use strict";
const S=["VO","MS","SHG"], ONLINE_MS=120000, st={admin:false,users:[],uid:null,user:null,db:null,mode:"VO"};
const $=id=>document.getElementById(id), C=()=>window.firebaseCloud, F=()=>C().getFirestore(), iso=()=>new Date().toISOString();
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
const p=u=>(u&&u.profile)||{}, a=u=>({VO:false,MS:false,SHG:false,...((u&&u.access)||{})}), role=u=>String(p(u).role||"user").toLowerCase()==="admin"?"admin":"user";
const online=u=>{const x=u?.presence||{},t=Date.parse(x.lastSeenAt||"");return x.online===true&&Number.isFinite(t)&&Date.now()-t<=ONLINE_MS};
const revoked=u=>S.every(m=>a(u)[m]!==true);
const fmt=v=>{if(!v)return"—";const d=new Date(v);return Number.isNaN(d.getTime())?String(v):d.toLocaleString()};
const msg=(id,t,ok=false)=>{const e=$(id);if(e){e.textContent=t||"";e.className="auth-msg"+(t?(ok?" ok":" error"):"")}};
function nav(v){$("adminNavBtn")?.classList.toggle("hidden",!v)}
async function isAdmin(){
  if(!C()?.currentUser){nav(false);return false}
  try{
    const s=await C().getDoc(C().doc(F(),"users",C().currentUser.uid));
    const d=s.exists()?s.data()||{}:{};
    st.admin=role(d)==="admin";
    window.__adminAuthorized=st.admin;
    nav(st.admin);
    return st.admin;
  }catch(e){
    // Keep the button visible when authentication has already confirmed the
    // admin profile; opening Admin will still be subject to the Firestore role
    // check above. This prevents a transient Firestore/read timing issue from
    // making the Admin tab disappear after login.
    const allowed=window.__adminAuthorized===true;
    st.admin=allowed;
    nav(allowed);
    console.warn("Admin role check failed:",e);
    return allowed;
  }
}
async function log(action,uid,name,details){if(!st.admin)return;try{await C().setDoc(C().doc(C().collection(F(),"systemLogs")),{action,adminUid:C().currentUser.uid,adminEmail:C().currentUser.email||"",targetUid:uid||"",targetName:name||"",details:details||"",createdAt:iso()},{merge:true})}catch(e){console.warn("Admin log failed",e)}}
function hideMain(){["voSelectionSection","voDetailsSection","dataManagementSection","dashboard","reportCenterSection"].forEach(id=>$(id)?.classList.add("hidden"))}
async function users(){if(!st.admin)return;const b=$("adminUsersBody");if(b)b.innerHTML='<tr><td colspan="7">Loading users...</td></tr>';try{const s=await C().getDocs(C().collection(F(),"users"));st.users=[];s.forEach(d=>st.users.push({uid:d.id,data:d.data()||{}}));st.users.sort((x,y)=>String(p(x.data).name||p(x.data).username||"").localeCompare(String(p(y.data).name||p(y.data).username||"")));render();stats();if(st.uid){const x=st.users.find(z=>z.uid===st.uid);if(x){st.user=x;details(x)}}}catch(e){if(b)b.innerHTML='<tr><td colspan="7">Unable to load users.</td></tr>';msg("adminUsersMsg",e.message||"Unable to load users.")}}
function filtered(){const q=String($("adminUserSearch")?.value||"").toLowerCase().trim(),sf=$("adminStatusFilter")?.value||"ALL",rf=$("adminRoleFilter")?.value||"ALL";return st.users.filter(x=>{const z=p(x.data),hay=[z.name,z.username,z.email,x.uid].join(" ").toLowerCase(),status=revoked(x.data)?"REVOKED":online(x.data)?"ONLINE":"OFFLINE";return(!q||hay.includes(q))&&(rf==="ALL"||role(x.data)===rf)&&(sf==="ALL"||status===sf)})}
function render(){const b=$("adminUsersBody");if(!b)return;const rows=filtered();$("adminUserCountLabel").textContent=`(${rows.length})`;if(!rows.length){b.innerHTML='<tr><td colspan="7">No users found.</td></tr>';return}b.innerHTML=rows.map((x,i)=>{const z=p(x.data),r=role(x.data),rv=revoked(x.data),on=online(x.data),stt=rv?"REVOKED":on?"ONLINE":"OFFLINE";return `<tr><td>${i+1}</td><td><b>${esc(z.name||z.username||"Unnamed")}</b></td><td>${esc(z.email||"")}</td><td><span class="admin-role-pill ${r==="admin"?"admin-role-admin":""}">${r==="admin"?"Admin":"User"}</span></td><td><span class="admin-status-pill admin-status-${stt.toLowerCase()}">${stt}</span></td><td>${esc(fmt(x.data.lastLoginAt||x.data.updatedAt))}</td><td><div class="admin-actions"><button class="primary admin-user-action" data-action="view" data-uid="${esc(x.uid)}">View</button><button class="secondary admin-user-action" data-action="edit" data-uid="${esc(x.uid)}">Edit</button><button class="secondary admin-user-action" data-action="reset" data-uid="${esc(x.uid)}">Reset Password</button><button class="${rv?"success":"danger"} admin-user-action" data-action="${rv?"restore":"revoke"}" data-uid="${esc(x.uid)}">${rv?"Restore Access":"Revoke Access"}</button><button class="danger admin-user-action" data-action="delete" data-uid="${esc(x.uid)}">Delete</button></div></td></tr>`}).join("")}
async function stats(){
  $("adminTotalUsers").textContent=st.users.length;$("adminOnlineUsers").textContent=st.users.filter(x=>online(x.data)).length;
  try{const q=await C().getDocs(C().collection(F(),"accessRequests"));let n=0;q.forEach(d=>{if(String(d.data()?.status||"PENDING").toUpperCase()==="PENDING")n++});$("adminPendingRequests").textContent=n;$("adminRequestBadge").textContent=n;$("adminRequestBadge").classList.toggle("hidden",!n)}catch(e){}
  let n=0;for(const u of st.users)for(const m of S){try{const rs=await C().getDocs(C().collection(F(),"users",u.uid,"modeData",m,"records"));if(rs.size)n+=rs.size;else{const us=await C().getDoc(C().doc(F(),"users",u.uid));if(us.exists()){const d=us.data()||{},f=m==="MS"?"msData":m==="SHG"?"shgData":"voData";n+=Array.isArray(d[f]?.vos)?d[f].vos.length:(m==="VO"&&Array.isArray(d.vos)?d.vos.length:0)}}}catch(e){}}$("adminTotalRecords").textContent=n;
}
function details(x){st.user=x;const z=p(x.data),aa=a(x.data),r=role(x.data),rv=revoked(x.data),on=online(x.data),i=String(z.name||z.username||z.email||"U").trim()[0]?.toUpperCase()||"U";$("adminUserDetails").innerHTML=`<div class="admin-detail-head"><div class="admin-detail-avatar">${esc(i)}</div><h3>${esc(z.name||z.username||"Unnamed User")}</h3><div class="admin-detail-email">${esc(z.email||"")}</div></div><div class="admin-detail-list"><div class="admin-detail-row"><b>Role</b><span>${r==="admin"?"Admin":"User"}</span></div><div class="admin-detail-row"><b>Status</b><span>${rv?"Revoked":on?"Online":"Offline"}</span></div><div class="admin-detail-row"><b>Joined Date</b><span>${esc(fmt(x.data.createdAt||x.data.joinedAt))}</span></div><div class="admin-detail-row"><b>Last Login</b><span>${esc(fmt(x.data.lastLoginAt))}</span></div><div class="admin-detail-row"><b>Last Seen</b><span>${esc(fmt(x.data.presence?.lastSeenAt))}</span></div><div class="admin-detail-row"><b>Access</b><span>${S.filter(m=>aa[m]===true).join(", ")||"None"}</span></div></div><div class="admin-detail-buttons"><button class="primary" data-detail="data">▤ Open User Data</button><button class="secondary" data-detail="edit">✎ Edit User</button><button class="secondary" data-detail="reset">🔑 Reset Password</button><button class="${rv?"success":"danger"}" data-detail="${rv?"restore":"revoke"}">${rv?"↻ Restore Access":"⊘ Revoke Access"}</button><button class="danger" style="grid-column:1/-1" data-detail="delete">▥ Delete User</button></div>`}
function select(uid){const x=st.users.find(z=>z.uid===uid);if(!x)return;st.uid=uid;st.user=x;details(x)}
async function edit(uid){const x=st.users.find(z=>z.uid===uid);if(!x)return;const z=p(x.data),aa=a(x.data);$("adminEditName").value=z.name||"";$("adminEditMobile").value=z.mobile||"";$("adminEditRole").value=role(x.data);$("adminEditAccessVO").checked=aa.VO===true;$("adminEditAccessMS").checked=aa.MS===true;$("adminEditAccessSHG").checked=aa.SHG===true;$("adminEditUserModal").dataset.uid=uid;msg("adminEditMsg","");$("adminEditUserModal").classList.remove("hidden")}
async function saveEdit(){const uid=$("adminEditUserModal").dataset.uid,x=st.users.find(z=>z.uid===uid);if(!x)return;if(uid===C().currentUser.uid&&$("adminEditRole").value!=="admin"){msg("adminEditMsg","You cannot remove your own admin role.");return}const r=$("adminEditRole").value,aa={VO:$("adminEditAccessVO").checked,MS:$("adminEditAccessMS").checked,SHG:$("adminEditAccessSHG").checked};if(r==="admin")S.forEach(m=>aa[m]=true);try{await C().setDoc(C().doc(F(),"users",uid),{profile:{...(x.data.profile||{}),name:$("adminEditName").value.trim(),mobile:$("adminEditMobile").value.trim(),role:r},access:aa,updatedAt:iso()},{merge:true});await log("EDIT_USER",uid,p(x.data).name||p(x.data).email,"Updated profile, role and access.");msg("adminEditMsg","User updated successfully.",true);setTimeout(()=>$("adminEditUserModal").classList.add("hidden"),300);await users()}catch(e){msg("adminEditMsg",e.message||"Unable to update user.")}}
async function reset(uid){const x=st.users.find(z=>z.uid===uid),email=String(p(x?.data).email||"").trim();if(!email)return alert("This user has no email address saved.");if(!confirm(`Send a password reset email to ${email}?`))return;try{await C().sendPasswordResetEmail(email);await log("RESET_PASSWORD",uid,p(x.data).name||email,"Sent Firebase password reset email.");alert("Password reset email sent to "+email+".")}catch(e){alert(e.message||"Unable to send password reset email.")}}
async function revokeOpen(uid){const x=st.users.find(z=>z.uid===uid);if(!x)return;$("adminRevokeModal").dataset.uid=uid;$("adminRevokeReason").value="";$("adminRevokeMode").value="ALL";$("adminRevokeHelp").textContent=`Revoke access for ${p(x.data).name||p(x.data).email||"this user"}.`;msg("adminRevokeMsg","");$("adminRevokeModal").classList.remove("hidden")}
async function revoke(){const uid=$("adminRevokeModal").dataset.uid,reason=$("adminRevokeReason").value.trim(),m=$("adminRevokeMode").value;if(!reason)return msg("adminRevokeMsg","Reason is required.");if(uid===C().currentUser.uid)return msg("adminRevokeMsg","You cannot revoke your own admin access.");const x=st.users.find(z=>z.uid===uid),aa=a(x.data);if(m==="ALL")S.forEach(k=>aa[k]=false);else aa[m]=false;try{await C().setDoc(C().doc(F(),"users",uid),{access:aa,status:m==="ALL"?"REVOKED":"ACTIVE",revokedAt:iso(),revokedBy:C().currentUser.uid,revokeReason:reason,updatedAt:iso()},{merge:true});await log("REVOKE_ACCESS",uid,p(x.data).name||p(x.data).email,`${m}: ${reason}`);msg("adminRevokeMsg","Access revoked.",true);setTimeout(()=>$("adminRevokeModal").classList.add("hidden"),250);await users()}catch(e){msg("adminRevokeMsg",e.message||"Unable to revoke access.")}}
async function restore(uid){
  const x=st.users.find(z=>z.uid===uid);
  if(!x||uid===C().currentUser.uid)return;
  const current=a(x.data);
  const available=S.filter(m=>current[m]!==true);
  if(!available.length){alert("This user already has access to all systems.");return;}
  const answer=String(prompt("Enter systems to restore: VO, MS, SHG or ALL. You can enter multiple systems separated by commas.",available.join(", "))||"").trim().toUpperCase();
  if(!answer)return;
  const selected=answer==="ALL"?available:Array.from(new Set(answer.split(/[\s,;]+/).filter(Boolean)));
  const invalid=selected.filter(m=>!S.includes(m));
  if(invalid.length){alert("Invalid system(s): "+invalid.join(", ")+". Use VO, MS, SHG or ALL.");return;}
  if(!selected.length)return;
  const aa={...current};
  selected.forEach(m=>aa[m]=true);
  try{
    await C().setDoc(C().doc(F(),"users",uid),{access:aa,status:"ACTIVE",updatedAt:iso()},{merge:true});
    await log("RESTORE_ACCESS",uid,p(x.data).name||p(x.data).email,`Restored ${selected.join(", ")} access.`);
    await users();
  }catch(e){alert(e.message||"Unable to restore access.")}
}
async function delUser(uid){
  const x=st.users.find(z=>z.uid===uid);
  if(!x)return;
  if(uid===C().currentUser.uid)return alert("You cannot delete your own admin account.");
  if(role(x.data)==="admin")return alert("An Admin cannot delete another Admin account.");
  const z=p(x.data);if(!confirm(`Delete ${z.name||z.email||"this user"}?\n\nThis permanently deletes the user's data and Firebase Authentication account when the Admin SDK function is deployed.`))return;
  try{
    if(typeof window.adminDeleteAuthUser==="function"){
      await window.adminDeleteAuthUser(uid);
      await log("DELETE_USER_ACCOUNT",uid,z.name||z.email,"Deleted Firebase Authentication account and Firestore data.");
      st.uid=null;$("adminUserDetails").innerHTML='<div class="admin-details-empty">Select a user to view details.</div>';await users();
      alert("User and Firebase Authentication account were permanently deleted.");
      return;
    }
    throw new Error("The Admin delete service is not available. Deploy firebase-functions/adminDeleteUser to us-central1, then try again.");
  }catch(e){
    console.error("Admin delete failed:",e);
    alert(e?.message||e?.details||"Unable to delete user. Please ensure the Admin SDK function is deployed.");
  }
}
async function requests(){const box=$("adminAccessRequests");if(!box)return;box.textContent="Loading requests...";try{const s=await C().getDocs(C().collection(F(),"accessRequests")),r=[];s.forEach(d=>r.push({id:d.id,...(d.data()||{})}));r.sort((x,y)=>String(y.requestedAt||"").localeCompare(String(x.requestedAt||"")));box.innerHTML=r.length?r.map(x=>{const q=String(x.status||"PENDING").toUpperCase(),b=q==="PENDING"?`<div class="request-actions"><button class="success admin-request-action" data-request-action="approve" data-request-id="${esc(x.id)}">Approve</button><button class="danger admin-request-action" data-request-action="reject" data-request-id="${esc(x.id)}">Reject</button><button class="secondary admin-request-delete" data-request-id="${esc(x.id)}">Delete</button></div>`:`<div class="request-actions"><button class="secondary admin-request-delete" data-request-id="${esc(x.id)}">Delete</button></div>`;return `<div class="admin-request-card"><div class="request-grid"><div><b>Name:</b> ${esc(x.name)}</div><div><b>Username:</b> ${esc(x.username)}</div><div><b>Email:</b> ${esc(x.email)}</div><div><b>Mobile:</b> ${esc(x.mobile)}</div><div><b>Requested Access:</b> ${esc(x.system)}</div><div><b>Status:</b> ${q}</div><div><b>Requested:</b> ${esc(fmt(x.requestedAt))}</div></div>${b}</div>`}).join(""):"No access requests found."}catch(e){box.textContent="Unable to load access requests.";msg("adminAccessMsg",e.message||"Unable to load access requests.")}}
async function requestAction(id,action){try{const ref=C().doc(F(),"accessRequests",id),s=await C().getDoc(ref);if(!s.exists())throw Error("Request no longer exists.");const r=s.data()||{};if(String(r.status||"").toUpperCase()!=="PENDING")throw Error("This request has already been processed.");if(action==="reject"){await C().setDoc(ref,{status:"REJECTED",rejectedBy:C().currentUser.uid,rejectedAt:iso(),updatedAt:iso()},{merge:true});await log("REJECT_ACCESS_REQUEST",r.uid,r.name||r.email,`Rejected ${r.system} request.`)}else{const m=String(r.system||"").toUpperCase();if(!S.includes(m))throw Error("Invalid requested system.");const ur=C().doc(F(),"users",r.uid),us=await C().getDoc(ur),u=us.exists()?us.data()||{}:{},aa=a(u);aa[m]=true;await C().setDoc(ur,{profile:{...(u.profile||{}),name:r.name||u.profile?.name||"",email:r.email||u.profile?.email||"",mobile:r.mobile||u.profile?.mobile||"",username:r.username||u.profile?.username||"",role:role(u)},access:aa,status:"ACTIVE",createdAt:u.createdAt||r.requestedAt||iso(),updatedAt:iso()},{merge:true});await C().setDoc(ref,{status:"APPROVED",approvedBy:C().currentUser.uid,approvedAt:iso(),updatedAt:iso()},{merge:true});await log("APPROVE_ACCESS_REQUEST",r.uid,r.name||r.email,`Approved ${m} request.`)}msg("adminAccessMsg",action==="approve"?"Access request approved.":"Access request rejected.",true);await requests();await users()}catch(e){msg("adminAccessMsg",e.message||"Unable to process request.")}}
async function delRequest(id){if(!confirm("Delete this access request?"))return;try{await C().deleteDoc(C().doc(F(),"accessRequests",id));await requests();await stats()}catch(e){msg("adminAccessMsg",e.message||"Unable to delete request.")}}
async function logs(){const b=$("adminLogsList");if(!b)return;try{const s=await C().getDocs(C().collection(F(),"systemLogs")),r=[];s.forEach(d=>r.push(d.data()||{}));r.sort((x,y)=>String(y.createdAt||"").localeCompare(String(x.createdAt||"")));b.innerHTML=r.length?r.slice(0,200).map(x=>`<div class="admin-log-row"><b>${esc(x.action||"ADMIN_ACTION")}</b><span class="admin-log-time">${esc(fmt(x.createdAt))}</span><div>${esc(x.details||"")}</div><div class="small">Admin: ${esc(x.adminEmail||x.adminUid||"")} ${x.targetName?` · Target: ${esc(x.targetName)}`:""}</div></div>`).join(""):"No logs yet."}catch(e){b.textContent="Unable to load system logs.";msg("adminLogsMsg",e.message||"Unable to load logs.")}}
async function loadData(uid,m){let v=[];try{const s=await C().getDocs(C().collection(F(),"users",uid,"modeData",m,"records"));s.forEach(d=>{const x=d.data()||{};if(x.data)v.push(x.data)})}catch(e){}if(!v.length){const s=await C().getDoc(C().doc(F(),"users",uid));if(s.exists()){const u=s.data()||{},f=m==="MS"?"msData":m==="SHG"?"shgData":"voData";if(Array.isArray(u[f]?.vos))v=u[f].vos;else if(m==="VO"&&Array.isArray(u.vos))v=u.vos}}v.sort((x,y)=>String(x.id||"").localeCompare(String(y.id||"")));return{vos:v}}
async function saveData(uid,m,d){const v=d.vos||[],f=m==="MS"?"msData":m==="SHG"?"shgData":"voData",u=C().doc(F(),"users",uid),payload={[f]:{vos:v},updatedAt:iso(),ownerUid:uid};if(m==="VO")payload.vos=v;try{await C().setDoc(u,payload,{merge:true});const old=await C().getDocs(C().collection(F(),"users",uid,"modeData",m,"records"));await Promise.all(old.docs.map(x=>C().deleteDoc(x.ref)))}catch(e){if(!/resource-exhausted|1 MiB|1048576|too large|maximum/i.test(String(e?.code||"")+" "+String(e?.message||"")))throw e;const ref=C().collection(F(),"users",uid,"modeData",m,"records"),keep=new Set();for(let i=0;i<v.length;i++){const r=v[i],id=String(r.id||`record_${i}`).replace(/\//g,"_");keep.add(id);await C().setDoc(C().doc(ref,id),{data:r,ownerUid:uid,mode:m,updatedAt:iso()},{merge:true})}const old=await C().getDocs(ref);await Promise.all(old.docs.filter(x=>!keep.has(x.id)).map(x=>C().deleteDoc(x.ref)))}}
async function openData(uid){const x=st.users.find(z=>z.uid===uid);if(!x)return;st.uid=uid;st.user=x;$("adminDataTitle").textContent=`User Data — ${p(x.data).name||p(x.data).email||"User"}`;$("adminDataSubtitle").textContent=p(x.data).email||uid;$("adminDataMode").value="VO";$("adminDataModal").classList.remove("hidden");await loadMode()}
async function loadMode(){const m=$("adminDataMode").value;st.mode=m;st.adminMonthIndex=0;try{st.db=await loadData(st.uid,m);const s=$("adminDataRecord");s.innerHTML="";st.db.vos.forEach((v,i)=>{const o=document.createElement("option");o.value=v.id||String(i);o.textContent=`${v.name||"Record "+(i+1)}${v.financialYear?" · "+v.financialYear:""}`;s.appendChild(o)});renderEditor()}catch(e){msg("adminDataMsg",e.message||"Unable to load user data.")}}
function adminMonths(fy){
  const m=String(fy||"2026-27").match(/^(\d{4})-(\d{2})$/),y=m?Number(m[1]):2026,n=String((y+1)%100).padStart(2,"0");
  return [[`Apr-${String(y).slice(-2)}`,`April-${y}`],[`May-${String(y).slice(-2)}`,`May-${y}`],[`Jun-${String(y).slice(-2)}`,`June-${y}`],[`Jul-${String(y).slice(-2)}`,`July-${y}`],[`Aug-${String(y).slice(-2)}`,`August-${y}`],[`Sep-${String(y).slice(-2)}`,`September-${y}`],[`Oct-${String(y).slice(-2)}`,`October-${y}`],[`Nov-${String(y).slice(-2)}`,`November-${y}`],[`Dec-${String(y).slice(-2)}`,`December-${y}`],[`Jan-${n}`,`January-${y+1}`],[`Feb-${n}`,`February-${y+1}`],[`Mar-${n}`,`March-${y+1}`]];
}
function loanTypes(m){
  return m==="SHG"
    ? [{key:"bankLinkage",label:"Bank Linkage"},{key:"streeNidhi",label:"Sree Nidhi"},{key:"voCif",label:"VO CIF"},{key:"internalLoan",label:"Internal"}]
    : [{key:"gc",label:"General CIF"},{key:"egc",label:"E Grade CIF"},{key:"pmfme",label:"PMFME CIF"},{key:"nutrigarden",label:"Nutrigarden CIF"},{key:"muc",label:"Mother Unit CIF"},{key:"rc",label:"Ramlamb CIF"},{key:"ccc",label:"Chaff Cutter CIF"},{key:"pop",label:"POP CIF"},{key:"nrlm",label:"NRLM CIF"},{key:"rmk",label:"RMK CIF"},{key:"sgsy",label:"SGSY CIF"},{key:"education",label:"Education CIF"},{key:"oc",label:"Other CIF"}];
}
function adminAccount(member,m,key){
  if(!member)return {};
  if(!member.loans || typeof member.loans!=="object")return member;
  const preferred=key||((loanTypes(m)[0]||{}).key);
  if(preferred && member.loans[preferred])return member.loans[preferred];
  const first=Object.values(member.loans).find(x=>x&&typeof x==="object");
  return first||member;
}
function ensureAdminLoan(member,m,key,rate){
  if(!member.loans || typeof member.loans!=="object")member.loans={};
  const k=key||((loanTypes(m)[0]||{}).key);
  if(!member.loans[k])member.loans[k]={name:member.name||"",interestRate:Number(rate)||12,startMonthIndex:Number.isInteger(member.startMonthIndex)?member.startMonthIndex:0,months:{}};
  return member.loans[k];
}
function adminCalc(d){
  const pp=Number(d?.prevPrincipal)||0,pi=Number(d?.prevInterest)||0,dp=Number(d?.demandPrincipal)||0,di=Number(d?.demandInterest)||0,cp=Number(d?.principalCollection)||0,ci=Number(d?.interestCollection)||0,op=Number(d?.opening)||0,nl=Number(d?.newLoan)||0;
  return {balancePrincipal:pp+dp-cp,balanceInterest:pi+di-ci,totalCollection:cp+ci,totalLoanBalance:op-cp+nl};
}
function syncLoanOptions(){
  const sel=$("adminDataLoan");if(!sel)return;
  const types=loanTypes(st.mode),cur=sel.value;
  sel.innerHTML=types.map(x=>`<option value="${esc(x.key)}">${esc(x.label)}</option>`).join("");
  sel.value=types.some(x=>x.key===cur)?cur:(types[0]?.key||"");
}
function renderEditor(){
  const box=$("adminDataEditor"),monthSel=$("adminDataMonth");
  const v=st.db?.vos?.find(x=>String(x.id)===String($("adminDataRecord")?.value))||st.db?.vos?.[0];
  if(!box||!v){if(box)box.innerHTML='<div class="admin-data-empty">No data record available.</div>';return;}
  syncLoanOptions();
  const loanKey=$("adminDataLoan")?.value||loanTypes(st.mode)[0]?.key||"cif";
  const months=adminMonths(v.financialYear);if(monthSel){monthSel.innerHTML=months.map((x,i)=>`<option value="${i}">${esc(x[1])}</option>`).join("");if(st.adminMonthIndex===undefined)st.adminMonthIndex=0;monthSel.value=String(Math.min(st.adminMonthIndex,months.length-1));}
  const idx=Number(monthSel?.value||0),key=months[idx][0],rows=[];
  (v.shgs||[]).forEach((member,i)=>{
    const acc=adminAccount(member,st.mode,loanKey),d=acc.months?.[key]||{};
    const c=adminCalc(d);
    rows.push(`<tr data-admin-row="${i}">
      <td>${i+1}</td>
      <td><input data-field="name" value="${esc(member.name||"")}"></td>
      ${st.mode==="SHG"?`<td><input type="number" data-field="savingOpening" value="${Number(d.savingOpening)||0}"></td><td><input type="number" data-field="savingCurrent" value="${Number(d.savingCurrent)||0}"></td><td><input type="number" data-field="savingDisbursed" value="${Number(d.savingDisbursed)||0}"></td>`:""}
      <td><input type="number" data-field="opening" value="${Number(d.opening)||0}"></td>
      <td><input type="number" data-field="prevPrincipal" value="${Number(d.prevPrincipal)||0}"></td>
      <td><input type="number" data-field="prevInterest" value="${Number(d.prevInterest)||0}"></td>
      <td><input type="number" data-field="demandPrincipal" value="${Number(d.demandPrincipal)||0}"></td>
      <td class="calc-cell">${Number(d.demandInterest)||0}</td>
      <td class="calc-cell">${(Number(d.prevPrincipal)||0)+(Number(d.demandPrincipal)||0)}</td>
      <td class="calc-cell">${(Number(d.prevInterest)||0)+(Number(d.demandInterest)||0)}</td>
      <td><input type="number" data-field="principalCollection" value="${Number(d.principalCollection)||0}"></td>
      <td><input type="number" data-field="interestCollection" value="${Number(d.interestCollection)||0}"></td>
      <td><input type="number" data-field="newLoan" value="${Number(d.newLoan)||0}"></td>
      <td class="calc-cell">${c.totalLoanBalance}</td>
      <td class="calc-cell">${c.totalCollection}</td><td><button type="button" class="success admin-row-save" data-admin-row-save="${i}">Save</button><button type="button" class="danger admin-row-delete" data-admin-row-delete="${i}">Delete</button></td>
    </tr>`);
  });
  const savings=st.mode==="SHG"?'<th>Saving Opening</th><th>Saving Current</th><th>Saving Disbursed</th>':'';
  box.innerHTML=`<div class="admin-data-record-meta"><span><b>${esc(v.name||"Unnamed")}</b></span><span>Financial Year: ${esc(v.financialYear||"—")}</span><span>Month: ${esc(months[idx][1])}</span><span>Records: ${(v.shgs||[]).length}</span></div>${rows.length?`<table class="admin-accounting-table"><thead><tr><th>S.N</th><th>${st.mode==="SHG"?"Member":"SHG / VO"} Name</th>${savings}<th>Opening Loan Balance</th><th>Previous Due Principal</th><th>Previous Due Interest</th><th>Current Month Principal</th><th>Current Month Interest</th><th>Previous + Current Principal</th><th>Previous + Current Interest</th><th>Principal Collection</th><th>Interest Collection</th><th>New Loan</th><th>Closing Loan Balance</th><th>Total Collection</th><th>Actions</th></tr></thead><tbody>${rows.join("")}</tbody></table>`:'<div class="admin-data-empty">No child/member records are available for this parent.</div>'}`;
}
async function addMember(){
  if(!st.db)return;
  const v=st.db.vos.find(x=>String(x.id)===String($("adminDataRecord").value));if(!v)return msg("adminDataMsg","Select a record first.");
  const name=String($("adminDataNewName")?.value||"").trim(),rate=Number($("adminDataNewRate")?.value||12);
  if(!name)return msg("adminDataMsg",`Enter ${st.mode==="SHG"?"member":"SHG / VO"} name.`);
  if(!Number.isFinite(rate)||rate<0||rate>100)return msg("adminDataMsg","Enter a valid interest rate between 0 and 100%.");
  v.shgs=Array.isArray(v.shgs)?v.shgs:[];
  if(v.shgs.some(x=>String(x.name||"").trim().toLowerCase()===name.toLowerCase()))return msg("adminDataMsg","That name already exists in this record.");
  const start=Number($("adminDataMonth")?.value||0),member={id:"SHG-"+Date.now()+"-"+Math.random().toString(36).slice(2),name,interestRate:rate,startMonthIndex:start,months:{},loans:{}};
  for(const t of loanTypes(st.mode))member.loans[t.key]={name,interestRate:rate,startMonthIndex:start,months:{}};
  v.shgs.push(member);
  try{await saveData(st.uid,st.mode,st.db);$("adminDataNewName").value="";msg("adminDataMsg",`${name} added successfully.`,true);await loadMode();await stats()}catch(e){msg("adminDataMsg",e.message||"Unable to add row.")}
}
async function deleteMember(i){
  const v=st.db?.vos?.find(x=>String(x.id)===String($("adminDataRecord").value));if(!v||!v.shgs?.[i])return;
  const name=v.shgs[i].name||(`Record ${i+1}`);if(!confirm(`Delete ${name}?\n\nAll monthly data for this ${st.mode==="SHG"?"member":"record"} will be removed.`))return;
  v.shgs.splice(i,1);try{await saveData(st.uid,st.mode,st.db);await log("DELETE_USER_DATA_ROW",st.uid,p(st.user?.data).name||p(st.user?.data).email,`Deleted ${st.mode} row ${name}.`);msg("adminDataMsg",`${name} deleted.`,true);await loadMode();await stats()}catch(e){msg("adminDataMsg",e.message||"Unable to delete row.")}
}
async function delRecord(){
  const v=st.db?.vos?.find(x=>String(x.id)===String($("adminDataRecord").value));if(!v)return msg("adminDataMsg","Select a record first.");
  if(!confirm(`Delete ${v.name||"this record"}?\n\nThis permanently removes the selected parent record and its monthly data for ${st.mode}.`))return;
  st.db.vos=st.db.vos.filter(x=>String(x.id)!==String(v.id));
  try{await saveData(st.uid,st.mode,st.db);await log("DELETE_USER_PARENT_DATA",st.uid,p(st.user?.data).name||p(st.user?.data).email,`Deleted ${st.mode} record ${v.id}.`);msg("adminDataMsg","Record deleted.",true);await loadMode();await stats()}catch(e){msg("adminDataMsg",e.message||"Unable to delete record.")}
}
async function saveRecord(){
  if(!st.db)return;
  const v=st.db.vos.find(x=>String(x.id)===String($("adminDataRecord").value));if(!v)return msg("adminDataMsg","Select a record first.");
  const months=adminMonths(v.financialYear),idx=Number($("adminDataMonth")?.value||0),key=months[idx][0],trs=[...document.querySelectorAll("#adminDataEditor tbody tr[data-admin-row]")];
  trs.forEach(tr=>{const i=Number(tr.dataset.adminRow),member=v.shgs?.[i];if(!member)return;const loanKey=$("adminDataLoan")?.value||loanTypes(st.mode)[0]?.key||"cif";const acc=adminAccount(member,st.mode,loanKey);if(!acc.months)acc.months={};if(!acc.months[key])acc.months[key]={};const d=acc.months[key];tr.querySelectorAll("[data-field]").forEach(el=>{const f=el.dataset.field;if(f==="name")member.name=el.value.trim();else d[f]=Number(el.value)||0;});d.demandInterest=Math.round((Number(d.opening)||0)*(Number(acc.interestRate??v.interestRate??12)||0)/100/12);});
  try{await saveData(st.uid,st.mode,st.db);await log("EDIT_USER_DATA",st.uid,p(st.user?.data).name||p(st.user?.data).email,`Edited ${st.mode} record ${v.id}, ${key}.`);msg("adminDataMsg","Changes saved successfully.",true);await loadMode();await stats()}catch(e){msg("adminDataMsg",e.message||"Unable to save changes.")}
}
async function saveRow(i){
  if(!st.db)return;
  const v=st.db.vos.find(x=>String(x.id)===String($("adminDataRecord").value));if(!v)return;
  const idx=Number($("adminDataMonth")?.value||0),key=adminMonths(v.financialYear)[idx][0],loanKey=$("adminDataLoan")?.value||loanTypes(st.mode)[0]?.key||"cif",member=v.shgs?.[i];if(!member)return;
  const tr=document.querySelector(`#adminDataEditor tr[data-admin-row="${i}"]`),acc=ensureAdminLoan(member,st.mode,loanKey,member.interestRate||v.interestRate||12);if(!acc.months)acc.months={};if(!acc.months[key])acc.months[key]={};const d=acc.months[key];
  tr?.querySelectorAll("[data-field]").forEach(el=>{const f=el.dataset.field;if(f==="name")member.name=el.value.trim();else d[f]=Number(el.value)||0;});d.demandInterest=Math.round((Number(d.opening)||0)*(Number(acc.interestRate??v.interestRate??12)||0)/100/12);
  try{await saveData(st.uid,st.mode,st.db);await log("EDIT_USER_DATA_ROW",st.uid,p(st.user?.data).name||p(st.user?.data).email,`Saved ${st.mode} row ${member.name}, ${key}.`);msg("adminDataMsg",`${member.name} saved.`,true);await loadMode();await stats()}catch(e){msg("adminDataMsg",e.message||"Unable to save row.")}
}
function pdf(type){if(!st.db||typeof window.adminPrintUserReport!=="function")return alert("The existing PDF renderer is not available.");window.adminPrintUserReport(st.db,st.mode,$("adminDataRecord").value,type);log("GENERATE_USER_PDF",st.uid,p(st.user?.data).name||p(st.user?.data).email,`${type} report for ${st.mode}.`)}
async function refresh(){if(!await isAdmin())return;await users();await requests();await logs()}
function tab(t){document.querySelectorAll(".admin-tab").forEach(x=>x.classList.toggle("admin-tab-active",x.dataset.adminTab===t));$("adminUsersPanel")?.classList.toggle("hidden",t!=="users");$("adminRequestsPanel")?.classList.toggle("hidden",t!=="requests");$("adminLogsPanel")?.classList.toggle("hidden",t!=="logs");if(t==="requests")requests();if(t==="logs")logs()}
async function open(){
  if(!await isAdmin())return alert("Administrator access is required.");
  /* Remember the accounting system that was active before Admin opened.
   * Home uses this value to return directly to that system instead of showing
   * the multi-system login selector again. */
  window.__adminReturnMode=(C().activeMode||window.selectedLoginSystem||"VO").toUpperCase();
  window.__adminActive=true;
  window.__returningFromAdmin=false;
  hideMain();
  $("adminSection")?.classList.remove("hidden");
  tab("users");
  await refresh();
  $("adminSection")?.scrollIntoView({behavior:"smooth",block:"start"})
}
document.addEventListener("click",e=>{const t=e.target.closest(".admin-tab");if(t)return tab(t.dataset.adminTab);const u=e.target.closest(".admin-user-action");if(u){const id=u.dataset.uid,a1=u.dataset.action;if(a1==="view")select(id);else if(a1==="edit")edit(id);else if(a1==="reset")reset(id);else if(a1==="revoke")revokeOpen(id);else if(a1==="restore")restore(id);else if(a1==="delete")delUser(id);return}const d=e.target.closest("[data-detail]");if(d&&st.uid){const a1=d.dataset.detail;if(a1==="data")openData(st.uid);else if(a1==="edit")edit(st.uid);else if(a1==="reset")reset(st.uid);else if(a1==="revoke")revokeOpen(st.uid);else if(a1==="restore")restore(st.uid);else if(a1==="delete")delUser(st.uid);return}const q=e.target.closest(".admin-request-action");if(q)return requestAction(q.dataset.requestId,q.dataset.requestAction);const dq=e.target.closest(".admin-request-delete");if(dq)return delRequest(dq.dataset.requestId);const pdfb=e.target.closest("[data-admin-pdf]");if(pdfb)return pdf(pdfb.dataset.adminPdf)});
$("adminNavBtn")?.addEventListener("click",open);$("adminRefreshBtn")?.addEventListener("click",refresh);$("adminUserSearch")?.addEventListener("input",render);$("adminStatusFilter")?.addEventListener("change",render);$("adminRoleFilter")?.addEventListener("change",render);$("adminSaveUserBtn")?.addEventListener("click",saveEdit);$("adminConfirmRevokeBtn")?.addEventListener("click",revoke);$("adminDataMode")?.addEventListener("change",loadMode);$("adminDataRecord")?.addEventListener("change",()=>{st.adminMonthIndex=0;renderEditor()});$("adminDataMonth")?.addEventListener("change",e=>{st.adminMonthIndex=Number(e.target.value)||0;renderEditor()});$("adminDataReloadBtn")?.addEventListener("click",loadMode);$("adminDataSaveBtn")?.addEventListener("click",saveRecord);$("adminDataDeleteBtn")?.addEventListener("click",delRecord);
$("adminDataLoan")?.addEventListener("change",()=>{st.adminMonthIndex=Number($("adminDataMonth")?.value||0);renderEditor()});$("adminDataAddBtn")?.addEventListener("click",addMember);
document.addEventListener("click",e=>{const rs=e.target.closest(".admin-row-save"),rd=e.target.closest(".admin-row-delete");if(rs)return saveRow(Number(rs.dataset.adminRowSave));if(rd)return deleteMember(Number(rd.dataset.adminRowDelete));});
window.loadAdminAccessRequests=requests;
window.addEventListener("firebase-cloud-ready",()=>{
  isAdmin().catch(()=>{});
  setTimeout(()=>isAdmin().catch(()=>{}),250);
});
setTimeout(()=>isAdmin().catch(()=>{}),0);
setTimeout(()=>isAdmin().catch(()=>{}),1000);
})();
