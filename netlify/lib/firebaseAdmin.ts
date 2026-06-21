import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore, Timestamp } from "firebase-admin/firestore";
import { loadLocalEnv } from "./localEnv";

loadLocalEnv();

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing ${name}`);
  }

  return value;
}

function getFirebaseApp(): App {
  if (getApps().length > 0) {
    return getApps()[0]!;
  }

  const base64ServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
  if (base64ServiceAccount) {
    const serviceAccount = JSON.parse(Buffer.from(base64ServiceAccount, "base64").toString("utf8"));
    return initializeApp({
      credential: cert(serviceAccount)
    });
  }

  return initializeApp({
    credential: cert({
      projectId: getRequiredEnv("FIREBASE_PROJECT_ID"),
      clientEmail: getRequiredEnv("FIREBASE_CLIENT_EMAIL"),
      privateKey: getRequiredEnv("FIREBASE_PRIVATE_KEY").replace(/\\n/g, "\n")
    })
  });
}

export const adminApp = getFirebaseApp();
export const adminAuth = getAuth(adminApp);
export const adminDb = getFirestore(adminApp);
export { FieldValue, Timestamp };
