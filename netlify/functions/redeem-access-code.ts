import type { Handler } from "@netlify/functions";
import { z } from "zod";
import { requireUser } from "../lib/auth";
import { writeAuditLog } from "../lib/audit";
import { adminDb, FieldValue } from "../lib/firebaseAdmin";
import { hashAccessCode } from "../lib/hashing";
import { ensurePost, handleError, HttpError, json, parseBody } from "../lib/responses";

const schema = z.object({
  code: z.string().min(4).max(64)
});

export const handler: Handler = async (event) => {
  const earlyResponse = ensurePost(event);
  if (earlyResponse) {
    return earlyResponse;
  }

  try {
    const user = await requireUser(event);
    const { code } = schema.parse(parseBody(event));
    const codeHash = hashAccessCode(code);
    const codeSnapshot = await adminDb
      .collection("accessCodes")
      .where("codeHash", "==", codeHash)
      .limit(1)
      .get();

    if (codeSnapshot.empty) {
      throw new HttpError(404, "Der Code ist ungültig.");
    }

    const codeDoc = codeSnapshot.docs[0]!;
    const codeData = codeDoc.data();
    const oneTime = process.env.ACCESS_CODE_ONE_TIME !== "false";
    const expiresAt = codeData.expiresAt?.toMillis?.() ?? 0;

    if (codeData.status !== "active" || (expiresAt && expiresAt < Date.now())) {
      throw new HttpError(403, "Der Code ist nicht mehr gültig.");
    }

    await adminDb.runTransaction(async (transaction) => {
      const freshCodeDoc = await transaction.get(codeDoc.ref);
      const freshCodeData = freshCodeDoc.data();
      if (!freshCodeData || freshCodeData.status !== "active") {
        throw new HttpError(409, "Der Code wurde bereits eingelöst.");
      }

      const accessBase = {
        uid: user.uid,
        orgId: freshCodeData.orgId,
        jobId: freshCodeData.jobId,
        classId: freshCodeData.classId,
        source: "accessCode",
        createdAt: FieldValue.serverTimestamp(),
        revokedAt: null
      };

      transaction.set(
        adminDb.collection("guardianAccess").doc(`${user.uid}_${freshCodeData.jobId}_${freshCodeData.childId}`),
        {
          ...accessBase,
          childId: freshCodeData.childId,
          scope: "child"
        },
        { merge: true }
      );
      transaction.set(
        adminDb.collection("guardianAccess").doc(`${user.uid}_${freshCodeData.jobId}_class_${freshCodeData.classId}`),
        {
          ...accessBase,
          scope: "class"
        },
        { merge: true }
      );
      transaction.set(
        adminDb.collection("guardianAccess").doc(`${user.uid}_${freshCodeData.jobId}_job`),
        {
          ...accessBase,
          scope: "job"
        },
        { merge: true }
      );

      if (oneTime) {
        transaction.update(codeDoc.ref, {
          status: "redeemed",
          redeemedByUid: user.uid,
          redeemedAt: FieldValue.serverTimestamp()
        });
      }
    });

    await writeAuditLog(user.uid, "access_code.redeemed", "accessCode", codeDoc.id, {
      jobId: codeData.jobId,
      childId: codeData.childId
    });

    return json(200, { jobId: codeData.jobId });
  } catch (error) {
    return handleError(error);
  }
};
