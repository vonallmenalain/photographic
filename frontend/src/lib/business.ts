/**
 * Angaben zur Betreiberin, die Startseite, AGB und Impressum anzeigen.
 *
 * Bewusst fest im Code (und nicht aus dem Backend geladen): TWINT verlangt
 * über Stripe, dass Firmenname mit Rechtsform, vollständige Geschäftsadresse
 * und mindestens eine E-Mail-Adresse oder Telefonnummer jederzeit sichtbar
 * sind – auch dann, wenn die API gerade nicht erreichbar ist. Die Angaben
 * müssen mit den Geschäftsdaten im Stripe-Konto übereinstimmen.
 */
export const BUSINESS = {
  /** Firmenname, wie er auf creart.ch und im Stripe-Konto steht. */
  name: 'CreArt',
  owner: 'Beatrice von Allmen',
  legalForm: 'Einzelunternehmen',
  street: 'Schlossmattstrasse 4',
  zipCity: '3400 Burgdorf',
  country: 'Schweiz',
  email: 'info@creart.ch',
  website: 'https://www.creart.ch',
  websiteLabel: 'creart.ch',
  /** Name dieser Bestellplattform. */
  platform: 'Photographic',
} as const;

/** „CreArt – Beatrice von Allmen“ */
export const BUSINESS_FULL_NAME = `${BUSINESS.name} – ${BUSINESS.owner}`;
