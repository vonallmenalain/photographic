import type { Handler } from "@netlify/functions";
import { z } from "zod";
import { requireAdmin } from "../lib/auth";
import { writeAuditLog } from "../lib/audit";
import { adminDb, FieldValue, Timestamp } from "../lib/firebaseAdmin";
import { generateAccessCode, hashAccessCode } from "../lib/hashing";
import { ensurePost, handleError, HttpError, json, parseBody } from "../lib/responses";

const schema = z.object({
  jobId: z.string().min(1),
  expiresInDays: z.number().int().min(1).max(365).optional()
});

export const handler: Handler = async (event) => {
  const earlyResponse = ensurePost(event);
  if (earlyResponse) {
    return earlyResponse;
  }

  try {
    const user = await requireAdmin(event);
    const input = schema.parse(parseBody(event));
    const expiresInDays = input.expiresInDays ?? Number(process.env.ACCESS_CODE_EXPIRES_DAYS ?? 60);
    const expiresAtDate = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);
    const expiresAt = Timestamp.fromDate(expiresAtDate);
    const childrenSnapshot = await adminDb
      .collection("children")
      .where("jobId", "==", input.jobId)
      .get();

    if (childrenSnapshot.empty) {
      throw new HttpError(404, "Keine Pseudonyme für diesen Job.");
    }

    const batch = adminDb.batch();
    const origin = process.env.URL ?? process.env.DEPLOY_PRIME_URL ?? "";
    const codes = childrenSnapshot.docs.map((childDoc) => {
      const child = childDoc.data();
      const code = generateAccessCode();
      const accessCodeRef = adminDb.collection("accessCodes").doc();

      batch.set(accessCodeRef, {
        orgId: child.orgId,
        jobId: child.jobId,
        classId: child.classId,
        childId: childDoc.id,
        codeHash: hashAccessCode(code),
        status: "active",
        redeemedByUid: null,
        redeemedAt: null,
        expiresAt,
        createdAt: FieldValue.serverTimestamp()
      });

      return {
        accessCodeId: accessCodeRef.id,
        childId: childDoc.id,
        classId: child.classId,
        pseudonym: child.pseudonym,
        code,
        qrPayload: origin ? `${origin}/access?code=${encodeURIComponent(code)}` : code,
        expiresAt: expiresAtDate.toISOString()
      };
    });

    await batch.commit();
    await writeAuditLog(user.uid, "access_codes.created", "job", input.jobId, {
      count: codes.length,
      expiresAt: expiresAtDate.toISOString()
    });

    return json(200, { codes });
  } catch (error) {
    return handleError(error);
  }
};
