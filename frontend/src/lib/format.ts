export function formatPrice(cents: number, currency = 'chf'): string {
  return new Intl.NumberFormat('de-DE', {
    style: 'currency',
    currency: currency.toUpperCase(),
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
