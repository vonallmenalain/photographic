import { AuthContext } from "./auth";
import { adminDb, serverTimestamp } from "./firebaseAdmin";

export async function writeAuditLog(
  actor: AuthContext,
  action: string,
  targetType: string,
  targetId: string,
  metadata: Record<string, unknown> = {}
) {
  try {
    await adminDb().collection("auditLogs").add({
      actorUid: actor.uid,
      actorEmail: actor.email,
      action,
      targetType,
      targetId,
      metadata,
      createdAt: serverTimestamp()
    });
  } catch (error) {
    console.error("[audit-log-failed]", {
      action,
      targetType,
      targetId,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}
