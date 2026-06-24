import * as admin from 'firebase-admin';
import fs from 'fs';
import { config } from '../config';

let app: admin.app.App | null = null;
let firestore: admin.firestore.Firestore | null = null;

function loadServiceAccount(): admin.ServiceAccount | null {
  const { serviceAccountJson, serviceAccountPath } = config.firebase;
  try {
    if (serviceAccountJson) {
      return JSON.parse(serviceAccountJson) as admin.ServiceAccount;
    }
    if (serviceAccountPath && fs.existsSync(serviceAccountPath)) {
      return JSON.parse(fs.readFileSync(serviceAccountPath, 'utf-8')) as admin.ServiceAccount;
    }
  } catch (err) {
    throw new Error(`Could not read Firebase service account: ${String(err)}`);
  }
  return null;
}

/**
 * Lazily initialises the Firebase Admin SDK. Works in three modes:
 *  - Emulator: FIRESTORE_EMULATOR_HOST / FIREBASE_AUTH_EMULATOR_HOST are set,
 *    no credentials required (great for local dev & CI).
 *  - Service account: provided via env (production on the QNAP).
 *  - Application Default Credentials: when running inside Google infra.
 */
export function getFirebaseApp(): admin.app.App {
  if (app) return app;
  if (admin.apps.length) {
    app = admin.app();
    return app;
  }

  const usingEmulator = Boolean(
    config.firebase.firestoreEmulatorHost || config.firebase.authEmulatorHost,
  );
  const serviceAccount = loadServiceAccount();

  const options: admin.AppOptions = {
    projectId: config.firebase.projectId,
    storageBucket: config.firebase.storageBucket || undefined,
  };

  if (serviceAccount) {
    options.credential = admin.credential.cert(serviceAccount);
  } else if (!usingEmulator) {
    // No explicit service account: fall back to ADC. This also covers Cloud Run
    // / GCE style deployments. Will throw later if no credentials are available.
    try {
      options.credential = admin.credential.applicationDefault();
    } catch {
      /* leave undefined; initializeApp will use ADC lazily */
    }
  }

  app = admin.initializeApp(options);
  return app;
}

export function db(): admin.firestore.Firestore {
  if (firestore) return firestore;
  firestore = getFirebaseApp().firestore();
  // Ignore undefined object properties so optional fields don't crash writes.
  firestore.settings({ ignoreUndefinedProperties: true });
  return firestore;
}

export function authAdmin(): admin.auth.Auth {
  return getFirebaseApp().auth();
}

export { admin };
