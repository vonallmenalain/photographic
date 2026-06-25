export function formatPrice(cents: number, currency = 'chf'): string {
  const code = currency.toUpperCase();
  // Swiss-style display, e.g. "15.- CHF" for whole francs and "15.50 CHF" otherwise.
  if (code === 'CHF') {
    const francs = Math.round(cents) / 100;
    const hasRappen = Math.round(cents) % 100 !== 0;
    const amount = hasRappen
      ? francs.toLocaleString('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : `${francs.toLocaleString('de-CH', { maximumFractionDigits: 0 })}.-`;
    return `${amount} CHF`;
  }
  return new Intl.NumberFormat('de-DE', {
    style: 'currency',
    currency: code,
  }).format(cents / 100);
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
