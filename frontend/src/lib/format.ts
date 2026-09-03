/**
 * Preis **ohne** Währungsangabe – so stehen Preise überall in der App:
 * "15.-" für ganze Franken, "15.50" mit Rappen. Der Shop rechnet durchgehend
 * in einer Währung; sie ein Dutzend Mal pro Bildschirm zu wiederholen macht
 * die Preise nur schwerer lesbar. Genannt wird sie einmal, bei der
 * Gesamtsumme im Warenkorb – siehe `formatPriceWithCurrency`.
 */
export function formatPrice(cents: number, currency = 'chf'): string {
  const code = currency.toUpperCase();
  // Swiss-style display, e.g. "15.-" for whole francs and "15.50" otherwise.
  if (code === 'CHF') {
    const francs = Math.round(cents) / 100;
    const hasRappen = Math.round(cents) % 100 !== 0;
    return hasRappen
      ? francs.toLocaleString('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : `${francs.toLocaleString('de-CH', { maximumFractionDigits: 0 })}.-`;
  }
  return new Intl.NumberFormat('de-DE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

/**
 * Preis **mit** Währungsangabe, z. B. "30.- CHF". Bewusst nur für die
 * Gesamtsumme im Warenkorb: dort steht der Betrag, den man tatsächlich
 * bezahlt, und genau dort soll die Währung unmissverständlich sein.
 */
export function formatPriceWithCurrency(cents: number, currency = 'chf'): string {
  return `${formatPrice(cents, currency)} ${currency.toUpperCase()}`;
}

export function formatDate(value: string): string {
  const d = new Date(value.includes('T') ? value : value.replace(' ', 'T') + 'Z');
  if (isNaN(d.getTime())) return value;
  return d.toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' });
}

export function formatDateShort(value: string): string {
  const d = new Date(value.includes('T') ? value : value.replace(' ', 'T') + 'Z');
  if (isNaN(d.getTime())) return value;
  return d.toLocaleDateString('de-DE', { dateStyle: 'medium' });
}

/**
 * Total of one cart/order line with tiered pricing: the first unit costs the
 * unit price, every further unit of the same photo/product costs the
 * additional price (e.g. "13×18 cm: 15.-, jedes weitere +4.-"). Without a
 * separate additional price every unit costs the unit price.
 */
export function lineTotalCents(
  unitPriceCents: number,
  additionalPriceCents: number | null | undefined,
  qty: number,
): number {
  const q = Math.max(0, Math.floor(qty));
  if (q === 0) return 0;
  const additional =
    typeof additionalPriceCents === 'number' ? additionalPriceCents : unitPriceCents;
  return unitPriceCents + (q - 1) * additional;
}

/** Whether a product has a cheaper price for further units of the same photo. */
export function hasTieredPrice(
  unitPriceCents: number,
  additionalPriceCents: number | null | undefined,
): boolean {
  return typeof additionalPriceCents === 'number' && additionalPriceCents !== unitPriceCents;
}

/** Short label of a product kind ("Druck", "Sticker", "Magnete", "Digital") for tables/badges. */
export function productKindLabel(kind: string | undefined | null, type?: string | null): string {
  switch (kind) {
    case 'sticker':
      return 'Sticker';
    case 'magnet':
      return 'Magnete';
    case 'photo':
      return 'Druck';
    case 'digital':
      return 'Digital';
    default:
      return type === 'print' ? 'Druck' : 'Digital';
  }
}
