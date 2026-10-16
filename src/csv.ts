import Papa from 'papaparse';

export interface Attendee {
  name: string;
  country: string;
  /** 1-based row number in the file, for pointing people at the source row. */
  line: number;
  issues: string[];
}

export interface ParseResult {
  attendees: Attendee[];
  notices: string[];
  error?: string;
}

const NAME_KEYS = ['name', 'fullname', 'participant', 'attendee', 'participantname', 'attendeename'];
const FIRST_KEYS = ['firstname', 'first', 'givenname', 'forename', 'vorname', 'prenom', 'voornaam'];
const LAST_KEYS = ['lastname', 'last', 'surname', 'familyname', 'nachname', 'nom', 'achternaam'];
const COUNTRY_KEYS = ['country', 'countryname', 'land', 'pays', 'nationality', 'state'];

/** Decode as UTF-8, falling back to Windows-1252 for files saved by older Excel versions. */
export function decodeBytes(buf: ArrayBuffer): string {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    text = new TextDecoder('windows-1252').decode(buf);
  }
  return text.replace(/^﻿/, '');
}

const normalizeHeader = (h: string) =>
  h.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '');

const clean = (v: string | undefined) => (v ?? '').replace(/\s+/g, ' ').trim();

const EXCEL_EXT = /\.(xlsx|xlsm|xls|ods)$/i;

/** Read a CSV or Excel file into attendees. */
export async function parseFile(file: File): Promise<ParseResult> {
  const buf = await file.arrayBuffer();
  if (EXCEL_EXT.test(file.name)) return parseSpreadsheet(buf);
  return parseCsv(decodeBytes(buf));
}

export function parseCsv(text: string): ParseResult {
  const parsed = Papa.parse<string[]>(text, { skipEmptyLines: 'greedy' });
  const result = parseRows(parsed.data);
  if (!result.error && parsed.errors.length) {
    result.notices.push(`The CSV has ${parsed.errors.length} formatting problem(s); check the rows below.`);
  }
  return result;
}

/** Excel / ODS: the first worksheet, using the values as displayed in the sheet. */
async function parseSpreadsheet(buf: ArrayBuffer): Promise<ParseResult> {
  // Loaded only when needed, so CSV users don't download the Excel reader.
  const XLSX = await import('xlsx');
  let rows: string[][];
  let firstRow = 0;
  try {
    const wb = XLSX.read(buf, { type: 'array' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    // Keep blank rows and the sheet's starting row so row numbers match what Excel shows.
    rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, raw: false, defval: '', blankrows: true });
    if (sheet['!ref']) firstRow = XLSX.utils.decode_range(sheet['!ref']).s.r;
  } catch {
    return { attendees: [], notices: [], error: 'Could not read this Excel file. Is it password-protected or damaged?' };
  }
  return parseRows(rows.map((r) => r.map((v) => String(v ?? ''))), firstRow);
}

/** How many leading rows to search for the header (Excel sheets often start with a title). */
const HEADER_SEARCH_ROWS = 10;

/** rowOffset: how many rows precede rows[0] in the source, for user-facing row numbers. */
export function parseRows(rows: string[][], rowOffset = 0): ParseResult {
  rows = rows.map((r) => r ?? []);
  if (!rows.some((r) => r.some((v) => clean(v)))) return { attendees: [], notices: [], error: 'The file is empty.' };
  const firstNonEmpty = rows.findIndex((r) => r.some((v) => clean(v)));

  let headerRow = -1;
  let nameIdx = -1;
  let firstIdx = -1;
  let lastIdx = -1;
  let countryIdx = -1;
  for (let i = firstNonEmpty; i < Math.min(rows.length, firstNonEmpty + HEADER_SEARCH_ROWS); i++) {
    const headers = rows[i].map((h) => normalizeHeader(String(h)));
    const find = (keys: string[]) => headers.findIndex((h) => keys.includes(h));
    const n = find(NAME_KEYS);
    const f = find(FIRST_KEYS);
    const l = find(LAST_KEYS);
    const c = find(COUNTRY_KEYS);
    if ((n >= 0 || f >= 0 || l >= 0) && c >= 0) {
      [headerRow, nameIdx, firstIdx, lastIdx, countryIdx] = [i, n, f, l, c];
      break;
    }
  }

  if (headerRow < 0) {
    const headers = rows[firstNonEmpty].map((h) => normalizeHeader(String(h)));
    const hasName = headers.some((h) => NAME_KEYS.includes(h) || FIRST_KEYS.includes(h) || LAST_KEYS.includes(h));
    const hasCountry = headers.some((h) => COUNTRY_KEYS.includes(h));
    const missing = [!hasName && '"name"', !hasCountry && '"country"'].filter(Boolean).join(' and ');
    const found = rows[firstNonEmpty].map((h) => String(h).trim()).filter(Boolean);
    return {
      attendees: [],
      notices: [],
      error:
        `This file is missing the ${missing} column${hasName || hasCountry ? '' : 's'}. ` +
        `The header row must contain "name" and "country". ` +
        (found.length ? `Columns found: ${found.join(', ')}.` : ''),
    };
  }

  const notices: string[] = [];
  if (headerRow > firstNonEmpty) notices.push(`Using row ${rowOffset + headerRow + 1} as the header row.`);

  const attendees: Attendee[] = [];
  const seen = new Map<string, number>();
  let skipped = 0;

  for (let i = headerRow + 1; i < rows.length; i++) {
    const r = rows[i];
    const name =
      nameIdx >= 0 ? clean(r[nameIdx]) : clean([firstIdx >= 0 ? r[firstIdx] : '', lastIdx >= 0 ? r[lastIdx] : ''].join(' '));
    const country = clean(r[countryIdx]);
    if (!name) {
      if (r.some((v) => clean(v))) skipped++;
      continue;
    }
    const line = rowOffset + i + 1;
    const issues: string[] = [];
    if (!country) issues.push('No country');
    const key = `${name.toLowerCase()}|${country.toLowerCase()}`;
    const prev = seen.get(key);
    if (prev !== undefined) issues.push(`Duplicate of row ${prev}`);
    else seen.set(key, line);
    attendees.push({ name, country, line, issues });
  }

  if (skipped) notices.push(`${skipped} row${skipped === 1 ? '' : 's'} without a name ${skipped === 1 ? 'was' : 'were'} skipped.`);
  if (attendees.length === 0) return { attendees, notices, error: 'The file has the right columns but no attendees.' };
  return { attendees, notices };
}
