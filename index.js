const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore } = require("firebase-admin/firestore");

initializeApp();

function fail(code, message) {
  throw new HttpsError(code, message);
}

async function requireAdmin(request) {
  if (!request.auth) fail("unauthenticated", "Login required.");

  const db = getFirestore();
  const email = String(request.auth.token?.email || "").toLowerCase();

  if (email === "chary.admin@charys-dcb.local") return db;

  const snap = await db.doc(`users/${request.auth.uid}`).get();
  const role = String(snap.data()?.profile?.role || "").toLowerCase();

  if (role !== "admin") {
    fail("permission-denied", "Administrator access required.");
  }

  return db;
}

async function deleteCollectionInBatches(refOrQuery, db) {
  const snap = await refOrQuery.get();
  if (!snap.size) return 0;

  let deleted = 0;
  let batch = db.batch();
  let count = 0;

  for (const docSnap of snap.docs) {
    batch.delete(docSnap.ref);
    count++;
    deleted++;

    // Keep comfortably below Firestore's 500-operation batch limit.
    if (count === 400) {
      await batch.commit();
      batch = db.batch();
      count = 0;
    }
  }

  if (count > 0) await batch.commit();
  return deleted;
}

exports.adminDeleteUser = onCall(
  {
    region: "us-central1",
    timeoutSeconds: 540,
    memory: "512MiB"
  },
  async (request) => {
    const targetUid = String(request.data?.uid || "").trim();

    try {
      const db = await requireAdmin(request);

      if (!targetUid) {
        fail("invalid-argument", "User UID is required.");
      }

      if (targetUid === request.auth.uid) {
        fail("failed-precondition", "You cannot delete your own account.");
      }

      const auth = getAuth();

      // ------------------------------------------------------------
      // Read target Auth account.
      // ------------------------------------------------------------
      let targetAuth;
      try {
        targetAuth = await auth.getUser(targetUid);
      } catch (e) {
        console.error("TARGET AUTH LOOKUP FAILED", {
          targetUid,
          code: e?.code,
          message: e?.message,
          stack: e?.stack
        });

        if (e?.code === "auth/user-not-found") {
          fail("not-found", "The selected Firebase Authentication account does not exist.");
        }

        fail(
          "failed-precondition",
          `Unable to read target Firebase account: ${e?.message || e?.code || "unknown error"}`
        );
      }

      // ------------------------------------------------------------
      // Read target Firestore profile.
      // ------------------------------------------------------------
      const userRef = db.doc(`users/${targetUid}`);
      let userSnap;

      try {
        userSnap = await userRef.get();
      } catch (e) {
        console.error("TARGET USER DOCUMENT READ FAILED", {
          targetUid,
          code: e?.code,
          message: e?.message,
          stack: e?.stack
        });

        fail(
          "failed-precondition",
          `Unable to read target user profile: ${e?.message || e?.code || "unknown error"}`
        );
      }

      const userData = userSnap.exists ? (userSnap.data() || {}) : {};
      const targetRole = String(userData?.profile?.role || "").toLowerCase();
      const authRole = String(targetAuth.customClaims?.role || "").toLowerCase();

      // Never allow Admin -> Admin deletion.
      if (targetRole === "admin" || authRole === "admin") {
        fail("permission-denied", "An Admin cannot delete another Admin account.");
      }

      // ------------------------------------------------------------
      // Delete application data.
      // ------------------------------------------------------------
      try {
        for (const mode of ["VO", "MS", "SHG"]) {
          const recordsRef = userRef
            .collection("modeData")
            .doc(mode)
            .collection("records");

          const count = await deleteCollectionInBatches(recordsRef, db);
          console.log(`Deleted ${count} ${mode} records`, { targetUid });
        }

        const requestCount = await deleteCollectionInBatches(
          db.collection("accessRequests").where("uid", "==", targetUid),
          db
        );
        console.log(`Deleted ${requestCount} access requests`, { targetUid });

        const usernameCount = await deleteCollectionInBatches(
          db.collection("usernames").where("uid", "==", targetUid),
          db
        );
        console.log(`Deleted ${usernameCount} username records`, { targetUid });

        const lookupCount = await deleteCollectionInBatches(
          db.collection("accountLookup").where("uid", "==", targetUid),
          db
        );
        console.log(`Deleted ${lookupCount} account lookup records`, { targetUid });

        if (userSnap.exists) {
          await userRef.delete();
        }
      } catch (e) {
        console.error("FIRESTORE CLEANUP FAILED", {
          targetUid,
          code: e?.code,
          message: e?.message,
          name: e?.name,
          stack: e?.stack
        });

        // IMPORTANT: never return HttpsError("internal", ...) here.
        // Firebase may sanitize that to the browser as "internal [0]".
        fail(
          "failed-precondition",
          `Firestore cleanup failed: ${e?.message || e?.code || "unknown Firestore error"}`
        );
      }

      // ------------------------------------------------------------
      // Delete Firebase Authentication account.
      // ------------------------------------------------------------
      try {
        await auth.deleteUser(targetUid);
      } catch (e) {
        console.error("FIREBASE AUTH DELETE FAILED", {
          targetUid,
          code: e?.code,
          message: e?.message,
          name: e?.name,
          stack: e?.stack
        });

        fail(
          "failed-precondition",
          `Firebase Authentication deletion failed: ${e?.message || e?.code || "unknown Auth error"}`
        );
      }

      // Logging must never make a successful deletion fail.
      try {
        await db.collection("systemLogs").add({
          action: "DELETE_USER_ACCOUNT",
          adminUid: request.auth.uid,
          targetUid,
          targetEmail: targetAuth.email || "",
          details: "Deleted user Firestore data and Firebase Authentication account.",
          createdAt: new Date().toISOString()
        });
      } catch (e) {
        console.warn("SYSTEM LOG WRITE FAILED", {
          targetUid,
          code: e?.code,
          message: e?.message
        });
      }

      return {
        ok: true,
        uid: targetUid,
        email: targetAuth.email || ""
      };

    } catch (e) {
      console.error("ADMIN DELETE FINAL ERROR", {
        targetUid,
        code: e?.code,
        message: e?.message,
        name: e?.name,
        details: e?.details,
        stack: e?.stack
      });

      if (e instanceof HttpsError) throw e;

      // Never expose a generic internal error when we have a useful message.
      throw new HttpsError(
        "failed-precondition",
        `Admin delete failed: ${e?.message || e?.code || "unknown server error"}`
      );
    }
  }
);
