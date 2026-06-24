import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  getAuth,
  isSignInWithEmailLink,
  sendSignInLinkToEmail,
  signInWithEmailLink,
  signOut,
  type Auth,
} from 'firebase/auth';

/**
 * Firebase web configuration. Values come from environment variables (set in
 * Netlify / .env), with the project defaults as a fallback so the app also runs
 * out of the box for this specific Firebase project.
 */
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY ?? 'AIzaSyDghVtwu3VI8BuZCE9wcOghlp9aL_3u428',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? 'photographic-7ba68.firebaseapp.com',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID ?? 'photographic-7ba68',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET ?? 'photographic-7ba68.firebasestorage.app',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? '83987903614',
  appId: import.meta.env.VITE_FIREBASE_APP_ID ?? '1:83987903614:web:f5fd8aadc4638eec87942f',
};

/** Firebase parent authentication is enabled whenever we have an API key. */
export const firebaseEnabled = Boolean(firebaseConfig.apiKey);

const EMAIL_STORAGE_KEY = 'firebase_email_for_signin';

let app: FirebaseApp | null = null;
let authInstance: Auth | null = null;

export function auth(): Auth {
  if (!app) app = initializeApp(firebaseConfig);
  if (!authInstance) authInstance = getAuth(app);
  return authInstance;
}

/**
 * Sends a passwordless sign-in link to the given e-mail. After the parent clicks
 * the link they return to /verifizieren where the sign-in is completed and an
 * ID token is exchanged for a backend session.
 */
export async function sendParentSignInLink(email: string): Promise<void> {
  const normalized = email.trim().toLowerCase();
  const actionCodeSettings = {
    url: `${window.location.origin}/verifizieren`,
    handleCodeInApp: true,
  };
  await sendSignInLinkToEmail(auth(), normalized, actionCodeSettings);
  window.localStorage.setItem(EMAIL_STORAGE_KEY, normalized);
}

export function isParentSignInLink(href: string): boolean {
  return firebaseEnabled && isSignInWithEmailLink(auth(), href);
}

export function getStoredSignInEmail(): string {
  return window.localStorage.getItem(EMAIL_STORAGE_KEY) ?? '';
}

/**
 * Completes the email-link sign-in and returns a fresh Firebase ID token to send
 * to the backend. `email` is required by Firebase to prevent session fixation;
 * we keep it in localStorage but fall back to an explicit value when needed
 * (e.g. the link was opened on a different device).
 */
export async function completeParentSignIn(href: string, email: string): Promise<string> {
  const cred = await signInWithEmailLink(auth(), email.trim().toLowerCase(), href);
  window.localStorage.removeItem(EMAIL_STORAGE_KEY);
  return cred.user.getIdToken();
}

export async function firebaseSignOut(): Promise<void> {
  if (!firebaseEnabled) return;
  try {
    await signOut(auth());
  } catch {
    /* ignore */
  }
}
