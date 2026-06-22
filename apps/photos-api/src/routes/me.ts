import { Router } from "express";
import { getAuthContext } from "../lib/auth";
import { adminDb, serverTimestamp } from "../lib/firebaseAdmin";
import { asyncHandler, sendOk } from "../lib/response";

export const meRouter = Router();

meRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const auth = getAuthContext(req);
    const ref = adminDb().collection("users").doc(auth.uid);
    const existing = await ref.get();

    await ref.set(
      {
        uid: auth.uid,
        email: auth.email,
        emailLower: auth.emailLower,
        role: auth.role,
        emailVerified: auth.emailVerified,
        createdAt: existing.exists ? existing.get("createdAt") : serverTimestamp(),
        updatedAt: serverTimestamp(),
        lastLoginAt: serverTimestamp()
      },
      { merge: true }
    );

    sendOk(res, {
      uid: auth.uid,
      email: auth.email,
      role: auth.role,
      emailVerified: auth.emailVerified
    });
  })
);
