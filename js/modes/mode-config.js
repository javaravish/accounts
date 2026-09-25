"use strict";

/*
 * Common mode resolver.
 * currentMode is owned by app-core.js and is declared before any call
 * to these functions. Keeping the mode definitions in separate files makes
 * VO/MS responsibilities easy to locate without changing their behavior.
 */
function modeConfig(){
  return currentMode === "MS" ? MS_MODE_CONFIG : VO_MODE_CONFIG;
}

function modeKey(){
  return modeConfig().storageKey;
}

function applyAccountingLabels(){
  const c=modeConfig();
  const set=(id,text)=>{const e=document.getElementById(id);if(e)e.textContent=text;};
  const setAttr=(id,attr,text)=>{const e=document.getElementById(id);if(e)e.setAttribute(attr,text);};

  set("loginTitle",`Chary's - ${c.parent} DCB & LL Login`);
  set("appTitle",`Chary's - ${c.parent} DCB & LL Dashboard`);
  set("parentSelectionTitle",`${c.parent} Selection & Creation`);
  set("existingParentLabel",`Existing ${c.parent}`);
  set("existingParentOption",`-- Select existing ${c.parent} --`);
  set("homeNewVoBtn",`Create New ${c.parent}`);
  set("newParentLabel",`New ${c.parent} Name`);
  setAttr("newVoName","placeholder",`Enter new ${c.parent} name`);
  set("createVoBtn",`Create ${c.parent}`);
  set("parentDetailsTitle",`${c.parent} Details`);
  set("parentNameLabel",`${c.parent} Name`);
  setAttr("voName","placeholder",`${c.parent} Name`);

  const isMS=currentMode==="MS";
  const villageField=document.getElementById("villageField");
  const villageLabel=document.getElementById("villageLabel");
  const districtLabel=document.getElementById("districtLabel");
  const detailsToolbar=document.getElementById("voDetailsToolbar");
  if(villageField)villageField.classList.toggle("hidden",isMS);
  if(detailsToolbar)detailsToolbar.classList.toggle("ms-mode",isMS);
  if(villageLabel)villageLabel.innerHTML=isMS?"Village":'Village <span style="color:#c62828">*</span>';
  if(districtLabel)districtLabel.innerHTML=isMS?'District <span style="color:#c62828">*</span>':"District";

  set("saveVoBtn",`Save ${c.parent}`);
  set("childMonthlyTitle",`${c.child} Wise Monthly Collection Data`);
  set("addChildLabel",`Add ${c.child} Name`);
  setAttr("shgNameInput","placeholder",`${c.child} Name`);
  set("addChildBold",`Add ${c.child}`);
  set("addShgBtn",`Add ${c.child}`);
  set("childTableNameHead",`${c.child} Name`);
  set("saveAllBtn",`Save All ${c.childPlural}`);
  set("allPdfsBtn",`Download ${c.parent} PDF`);
  const h=document.querySelector('link[rel="icon"]');
  if(h)h.href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='14' fill='%2317365d'/%3E%3Ctext x='32' y='42' text-anchor='middle' font-family='Arial,sans-serif' font-size='25' font-weight='700' fill='white'%3E${c.parent}%3C/text%3E%3C/svg%3E";
  document.title=`Chary's - ${c.parent} DCB & LL`;
}
