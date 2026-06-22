import { Router } from "express";
import { getAuthContext } from "../lib/auth";
import { writeAuditLog } from "../lib/audit";
import { adminDb, serverTimestamp } from "../lib/firebaseAdmin";
import { canAccessPhoto, getActiveGuardianLinks, getPhoto } from "../lib/firestore";
import { asyncHandler, AppError, sendOk } from "../lib/response";
import { mockOrderSchema } from "../lib/validators";

export const ordersRouter = Router();

ordersRouter.post(
  "/mock",
  asyncHandler(async (req, res) => {
    const auth = getAuthContext(req);
    const input = mockOrderSchema.parse(req.body);
    const guardianLinks =
      auth.role === "admin" ? [] : await getActiveGuardianLinks(auth.emailLower);

    for (const item of input.items) {
      const photo = await getPhoto(item.photoId);
      if (!photo || photo.jobId !== input.jobId || !canAccessPhoto(auth, photo, guardianLinks)) {
        throw new AppError(
          403,
          "ORDER_ITEM_FORBIDDEN",
          "Mindestens ein Foto im Warenkorb ist nicht freigegeben."
        );
      }
    }

    const orderRef = await adminDb().collection("orders").add({
      uid: auth.uid,
      emailLower: auth.emailLower,
      jobId: input.jobId,
      status: "pending",
      paymentProvider: "mock",
      items: input.items,
      amount: 0,
      currency: "CHF",
      createdAt: serverTimestamp()
    });

    await writeAuditLog(auth, "guardian.create.mockOrder", "order", orderRef.id, {
      jobId: input.jobId,
      itemCount: input.items.length
    });

    sendOk(res, {
      orderId: orderRef.id,
      message: "Mock-Bestellung gespeichert. Zahlung wird in einer spaeteren Version mit Stripe ergaenzt."
    });
  })
);
