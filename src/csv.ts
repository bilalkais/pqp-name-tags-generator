import Papa from 'papaparse';

export interface Attendee {
  name: string;
  country: string;
  /** 1-based line number in the CSV, for pointing people at the source row. */
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

export function parseCsv(text: string): ParseResult {
  const parsed = Papa.parse<string[]>(text, { skipEmptyLines: 'greedy' });
  const rows = parsed.data;
  if (rows.length === 0) return { attendees: [], notices: [], error: 'The file is empty.' };

  const headers = rows[0].map(normalizeHeader);
  const find = (keys: string[]) => headers.findIndex((h) => keys.includes(h));
  let nameIdx = find(NAME_KEYS);
  let firstIdx = find(FIRST_KEYS);
  let lastIdx = find(LAST_KEYS);
  let countryIdx = find(COUNTRY_KEYS);

  const notices: string[] = [];
  let dataStart = 1;
  if (nameIdx < 0 && firstIdx < 0 && lastIdx < 0) {
    if (countryIdx >= 0) {
      return {
        attendees: [],
        notices,
        error: `Found a country column but no name column. Columns found: ${rows[0].join(', ')}`,
      };
    }
    // No recognisable header: treat the file as plain "name, country" rows.
    nameIdx = 0;
    countryIdx = rows[0].length > 1 ? 1 : -1;
    dataStart = 0;
    notices.push('No header row recognised. Assuming column 1 is the name and column 2 is the country.');
  } else if (countryIdx < 0) {
    notices.push('No country column found. Tags will show names only.');
  }

  const attendees: Attendee[] = [];
  const seen = new Map<string, number>();
  let skipped = 0;

  for (let i = dataStart; i < rows.length; i++) {
    const r = rows[i];
    const name =
      nameIdx >= 0 ? clean(r[nameIdx]) : clean([firstIdx >= 0 ? r[firstIdx] : '', lastIdx >= 0 ? r[lastIdx] : ''].join(' '));
    const country = countryIdx >= 0 ? clean(r[countryIdx]) : '';
    if (!name) {
      if (r.some((v) => clean(v))) skipped++;
      continue;
    }
    const line = i + 1;
    const issues: string[] = [];
    if (countryIdx >= 0 && !country) issues.push('No country');
    const key = `${name.toLowerCase()}|${country.toLowerCase()}`;
    const prev = seen.get(key);
    if (prev !== undefined) issues.push(`Duplicate of line ${prev}`);
    else seen.set(key, line);
    attendees.push({ name, country, line, issues });
  }

  if (skipped) notices.push(`${skipped} row${skipped === 1 ? '' : 's'} without a name ${skipped === 1 ? 'was' : 'were'} skipped.`);
  if (parsed.errors.length) notices.push(`The CSV has ${parsed.errors.length} formatting problem(s); check the rows below.`);
  return { attendees, notices };
}
