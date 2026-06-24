/**
 * Turns the different admin inputs (a pasted table, a CSV file or an Excel
 * workbook) into a uniform 2-D array of strings. The semantic interpretation
 * (which column is which, what gets created) happens on the backend.
 */

/** Detects the most likely delimiter of a pasted/CSV text block. */
function detectDelimiter(text: string): string {
  const sample = text.split(/\r?\n/).slice(0, 10).join('\n');
  const counts: Record<string, number> = {
    '\t': (sample.match(/\t/g) || []).length,
    ';': (sample.match(/;/g) || []).length,
    ',': (sample.match(/,/g) || []).length,
  };
  let best = ',';
  let bestCount = -1;
  for (const [d, c] of Object.entries(counts)) {
    if (c > bestCount) {
      best = d;
      bestCount = c;
    }
  }
  return best;
}

/** Minimal RFC-4180-ish CSV/TSV parser supporting quoted fields. */
export function parseDelimited(text: string, delimiter?: string): string[][] {
  const delim = delimiter ?? detectDelimiter(text);
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === delim) {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (ch === '\r') {
      // handled together with the following \n
    } else {
      field += ch;
    }
  }
  // flush trailing field/row
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows
    .map((r) => r.map((c) => c.trim()))
    .filter((r) => r.some((c) => c !== ''));
}

/** Parses an .xlsx/.xls workbook using a lazily loaded SheetJS module. */
async function parseWorkbook(file: File): Promise<string[][]> {
  const XLSX = await import('xlsx');
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return [];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false, defval: '' });
  return rows
    .map((r) => (Array.isArray(r) ? r.map((c) => (c == null ? '' : String(c).trim())) : []))
    .filter((r) => r.some((c) => c !== ''));
}

/** Reads any supported file (CSV / TSV / TXT / XLSX) into rows. */
export async function parseFile(file: File): Promise<string[][]> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    return parseWorkbook(file);
  }
  const text = await file.text();
  return parseDelimited(text);
}
