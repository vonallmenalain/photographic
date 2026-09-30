import { useEffect, useState } from 'react';
import { api } from '../api/client';

/**
 * Öffentliche Angaben der Website (Kontaktadresse, Versandpauschale,
 * Zahlungsarten), die der Admin unter „Einstellungen“ bzw. in der `.env` pflegt. Werden einmal geladen und für die Dauer
 * der Sitzung zwischengespeichert, damit Impressum und Hilfe-Seite nicht bei
 * jedem Aufruf neu anfragen.
 */
export interface SiteInfo {
  contactEmail: string;
  shippingFeeCents: number;
  currency: string;
  retentionDays: number;
  /** Zahlungsarten der Bezahlseite (Stripe-Codes wie `card`, `twint`). */
  paymentMethods: string[];
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
          paymentMethods: Array.isArray(info.paymentMethods)
            ? info.paymentMethods.map((m) => String(m))
            : [],
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

/**
 * Lesbare Namen der Zahlungsarten für Startseite, AGB und Impressum. Apple Pay
 * und Google Pay laufen bei Stripe über `card` und erscheinen deshalb mit der
 * Karte. Leere Liste = keine Angabe möglich (dann nennt die Bezahlseite sie).
 */
export function paymentMethodLabels(methods: string[]): string[] {
  const labels: string[] = [];
  for (const m of methods) {
    switch (m) {
      case 'card':
        labels.push('Kredit- und Debitkarte', 'Apple Pay', 'Google Pay');
        break;
      case 'twint':
        labels.push('TWINT');
        break;
      case 'paypal':
        labels.push('PayPal');
        break;
      case 'klarna':
        labels.push('Klarna');
        break;
      case 'link':
        labels.push('Link');
        break;
      default:
        labels.push(m.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()));
    }
  }
  return Array.from(new Set(labels));
}
