import { adminDb, FieldValue } from "./firebaseAdmin";

export async function writeAuditLog(
  actorUid: string,
  action: string,
  targetType: string,
  targetId: string,
  metadata: Record<string, unknown> = {}
): Promise<void> {
  await adminDb.collection("auditLogs").add({
    actorUid,
    action,
    targetType,
    targetId,
    metadata,
    createdAt: FieldValue.serverTimestamp()
  });
}
