/**
 * Minimal CSV helpers. Deliberately dependency-free — Excel is the only consumer.
 */

type Row = Record<string, string | number>;

function escapeCell(value: string | number): string {
  const s = String(value ?? '');
  // A leading =, +, - or @ makes Excel treat the cell as a formula. Plates and
  // references can start with those, so prefix a quote to neutralise it.
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** Convert an array of flat objects to a CSV string using the first row's keys as headers. */
export function toCsv(rows: Row[]): string {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0]);
  const lines = [
    headers.map(escapeCell).join(','),
    ...rows.map((row) => headers.map((h) => escapeCell(row[h])).join(',')),
  ];
  return lines.join('\r\n');
}

/** Join several titled tables into one CSV file, separated by blank lines. */
export function toCsvSections(sections: { title: string; rows: Row[] }[]): string {
  return sections
    .filter((s) => s.rows.length > 0)
    .map((s) => `${escapeCell(s.title)}\r\n${toCsv(s.rows)}`)
    .join('\r\n\r\n');
}

/** Trigger a browser download of the given CSV text. */
export function downloadCsv(filename: string, csv: string) {
  // The BOM makes Excel open UTF-8 correctly instead of mangling accents.
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
