import admin from "firebase-admin";
import { env } from "../config/env";
import { AppError } from "./response";

function decodeServiceAccount() {
  if (!env.FIREBASE_SERVICE_ACCOUNT_BASE64) {
    throw new AppError(
      500,
      "FIREBASE_NOT_CONFIGURED",
      "Firebase Admin ist auf dem Backend noch nicht konfiguriert."
    );
  }

  try {
    const json = Buffer.from(env.FIREBASE_SERVICE_ACCOUNT_BASE64, "base64").toString("utf8");
    return JSON.parse(json) as admin.ServiceAccount;
  } catch {
    throw new AppError(
      500,
      "FIREBASE_CONFIG_INVALID",
      "Firebase Admin Konfiguration ist ungültig."
    );
  }
}

export function getAdminApp() {
  if (admin.apps.length > 0) {
    return admin.app();
  }

  const serviceAccount = decodeServiceAccount();

  return admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: env.FIREBASE_PROJECT_ID || serviceAccount.projectId
  });
}

export function adminAuth() {
  return getAdminApp().auth();
}

export function adminDb() {
  return getAdminApp().firestore();
}

export function serverTimestamp() {
  return admin.firestore.FieldValue.serverTimestamp();
}
