import { initializeApp } from "firebase/app";
import type { FirebaseApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import type { Auth } from "firebase/auth";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY ?? "",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? "",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID ?? "",
  appId: import.meta.env.VITE_FIREBASE_APP_ID ?? "",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? ""
};

const requiredConfig = [
  ["VITE_FIREBASE_API_KEY", firebaseConfig.apiKey],
  ["VITE_FIREBASE_AUTH_DOMAIN", firebaseConfig.authDomain],
  ["VITE_FIREBASE_PROJECT_ID", firebaseConfig.projectId],
  ["VITE_FIREBASE_APP_ID", firebaseConfig.appId],
  ["VITE_FIREBASE_MESSAGING_SENDER_ID", firebaseConfig.messagingSenderId]
];

const missingConfig = requiredConfig
  .filter(([, value]) => !value)
  .map(([name]) => name);

export let firebaseConfigError: string | null =
  missingConfig.length > 0
    ? `Firebase ist nicht vollständig konfiguriert. Fehlend: ${missingConfig.join(", ")}.`
    : null;

export let firebaseApp: FirebaseApp | null = null;
export let auth: Auth | null = null;

if (!firebaseConfigError) {
  try {
    firebaseApp = initializeApp(firebaseConfig);
    auth = getAuth(firebaseApp);
    auth.languageCode = "de";
  } catch (error) {
    console.error("Firebase konnte nicht initialisiert werden.", error);
    firebaseConfigError =
      "Firebase konnte nicht initialisiert werden. Bitte prüfe die VITE_FIREBASE_* Variablen in Netlify.";
  }
}
