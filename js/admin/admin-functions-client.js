import {getFunctions,httpsCallable} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-functions.js";

// The Admin delete operation must go through the Firebase Admin SDK callable
// function. Do not fall back to client-side Firestore deletion: that fallback
// can produce a misleading "Missing or insufficient permissions" error and
// cannot delete the target Firebase Authentication account anyway.
const functions=getFunctions(undefined,"us-central1");
const adminDeleteUserCall=httpsCallable(functions,"adminDeleteUser");

window.adminDeleteAuthUser=async uid=>{
  const targetUid=String(uid||"").trim();
  if(!targetUid)throw new Error("User UID is required.");
  try{
    return await adminDeleteUserCall({uid:targetUid});
  }catch(e){
    console.error("adminDeleteUser callable failed:",e);
    const code=String(e?.code||"").toLowerCase();
    const raw=String(e?.details||e?.message||"");
    console.error("adminDeleteUser details:", {code:e?.code, message:e?.message, details:e?.details});
    if(code.includes("not-found")||code.includes("functions/not-found")||code.includes("unavailable")){
      throw new Error("The Firebase adminDeleteUser function is not deployed or is unavailable. Deploy firebase-functions/adminDeleteUser to us-central1 and try again.");
    }
    if(code.includes("permission-denied")){
      throw new Error(raw||"Administrator permission denied by the adminDeleteUser function. Make sure the signed-in account is an Admin.");
    }
    if(code.includes("unauthenticated")){
      throw new Error("Your Admin session has expired. Please log in again.");
    }
    if(code.includes("failed-precondition")){
      throw new Error(raw||"This user cannot be deleted.");
    }
    if(code.includes("invalid-argument")){
      throw new Error(raw||"Invalid user selected for deletion.");
    }
    if(code.includes("internal")){
      throw new Error(raw||"The adminDeleteUser server function failed. Open Firebase Functions logs for adminDeleteUser and check the exact server error.");
    }
    throw new Error(raw||"Admin user deletion failed. Check the Firebase Functions logs for adminDeleteUser.");
  }
};
