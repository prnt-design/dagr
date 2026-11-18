import { realpath, readdir, readFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { validateReport } from '../../reports/src/index.js';

export async function loadArchive(directory: string) {
  const names = (await readdir(directory)).filter(n => /^\d{4}-\d{2}-\d{2}\.json$/.test(n)).sort();
  const raw = new Map<string, unknown>();
  const errors: Record<string, string[]> = {};
  for (const name of names) {
    const date = name.slice(0, -5);
    try {
      const path = await realpath(resolve(directory, name));
      if (relative(directory, path) !== name) throw new Error('Report symlink outside archive');
      raw.set(date, JSON.parse(await readFile(path, 'utf8')));
    } catch { errors[date] = ['Unreadable report']; }
  }
  const reports = [];
  for (const [date, input] of raw) {
    const previousDate = input && typeof input === 'object' && 'previousDate' in input ? input.previousDate : null;
    if (typeof previousDate === 'string' && !raw.has(previousDate)) {
      errors[date] = ['Named baseline report is missing or unreadable'];
      continue;
    }
    const result = validateReport(input, typeof previousDate === 'string' ? raw.get(previousDate) : undefined);
    if (!result.ok) errors[date] = result.errors;
    else if (result.report.date !== date) errors[date] = ['Filename/date mismatch'];
    else reports.push(result.report);
  }
  return { reports, errors, dates: names.map(n => n.slice(0, -5)) };
}
