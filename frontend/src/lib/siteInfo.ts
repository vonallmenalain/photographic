import { useEffect, useState } from 'react';
import { api } from '../api/client';

/**
 * Öffentliche Angaben der Website (Kontaktadresse, Versandpauschale), die der
 * Admin unter „Einstellungen“ pflegt. Werden einmal geladen und für die Dauer
 * der Sitzung zwischengespeichert, damit Impressum und Hilfe-Seite nicht bei
 * jedem Aufruf neu anfragen.
 */
export interface SiteInfo {
  contactEmail: string;
  shippingFeeCents: number;
  currency: string;
  retentionDays: number;
}

let cached: SiteInfo | null = null;
let pending: Promise<SiteInfo> | null = null;

export function loadSiteInfo(): Promise<SiteInfo> {
  if (cached) return Promise.resolve(cached);
  if (!pending) {
    pending = api<SiteInfo>('/api/parent/site')
      .then((info) => {
        cached = {
          contactEmail: String(info.contactEmail ?? ''),
          shippingFeeCents: Math.max(0, Number(info.shippingFeeCents) || 0),
          currency: String(info.currency || 'chf'),
          retentionDays: Number(info.retentionDays) || 30,
        };
        return cached;
      })
      .finally(() => {
        pending = null;
      });
  }
  return pending;
}

/** React-Hook: `null`, solange die Angaben noch nicht geladen sind (oder der Abruf scheiterte). */
export function useSiteInfo(): SiteInfo | null {
  const [info, setInfo] = useState<SiteInfo | null>(cached);
  useEffect(() => {
    let cancelled = false;
    loadSiteInfo()
      .then((i) => {
        if (!cancelled) setInfo(i);
      })
      .catch(() => {
        /* Impressum/Hilfe funktionieren auch ohne diese Angaben */
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return info;
}
