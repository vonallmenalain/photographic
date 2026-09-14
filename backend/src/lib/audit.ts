import { COL, setById, nowIso } from '../db';
import { newId } from './ids';

/**
 * Eintrag im Audit-Log. `actor` ist der Admin-Benutzername, die E-Mail-Adresse
 * einer Lehrperson bzw. eines Elternteils oder „system“ für automatische
 * Abläufe (z. B. automatische Erinnerungen).
 */
export async function audit(action: string, detail: string, actor = 'admin'): Promise<void> {
  await setById(COL.auditLog, newId('aud'), {
    actor,
    action,
    detail,
    created_at: nowIso(),
  });
}
