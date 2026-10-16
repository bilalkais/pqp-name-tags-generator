import fontkit from '@pdf-lib/fontkit';
import './style.css';
import { decodeBytes, parseCsv, type Attendee } from './csv.ts';
import { LAYOUTS, DEFAULT_LAYOUT_ID, getLayout } from './layouts.ts';
import { buildPreviewPdf, buildSheetPdf, MONTHS, type Assets, type Person, type TagSettings } from './pdf.ts';

interface Settings extends TagSettings {
  blankCount: number;
  sort: 'csv' | 'name' | 'country';
}

const STORAGE_KEY = 'pqp-name-tags-settings';
const SAMPLE: Person = { name: 'Amina Hadžić', country: 'Bosnia and Herzegovina' };

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const now = new Date();
const defaults: Settings = {
  title: 'PQP',
  className: '',
  year: now.getFullYear(),
  month: now.getMonth() + 1,
  layoutId: DEFAULT_LAYOUT_ID,
  cropMarks: true,
  blankCount: 0,
  sort: 'csv',
};

function loadSettings(): Settings {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    return { ...defaults, ...saved };
  } catch {
    return { ...defaults };
  }
}

function saveSettings() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    /* storage unavailable; settings just won't persist */
  }
}

let settings = loadSettings();
let attendees: Attendee[] = [];
const excluded = new Set<number>(); // by CSV line
let previewLine: number | null = null;
let assets: Assets | null = null;
let supportedChars: Set<number> | null = null;

// ---- Form wiring ----

const monthSel = $<HTMLSelectElement>('month');
MONTHS.forEach((m, i) => monthSel.add(new Option(m, String(i + 1))));
const layoutSel = $<HTMLSelectElement>('layoutId');
LAYOUTS.forEach((l) => layoutSel.add(new Option(l.label, l.id)));

const fields = ['title', 'className', 'month', 'year', 'layoutId', 'sort', 'blankCount', 'cropMarks'] as const;

function writeForm() {
  for (const f of fields) {
    const el = $<HTMLInputElement>(f);
    if (el.type === 'checkbox') el.checked = Boolean(settings[f]);
    else el.value = String(settings[f]);
  }
}

function readForm() {
  const val = (id: string) => $<HTMLInputElement>(id).value;
  const int = (id: string, fallback: number) => {
    const n = parseInt(val(id), 10);
    return Number.isFinite(n) ? n : fallback;
  };
  settings = {
    title: val('title'),
    className: val('className'),
    month: int('month', defaults.month),
    year: int('year', defaults.year),
    layoutId: val('layoutId'),
    sort: val('sort') as Settings['sort'],
    blankCount: Math.max(0, Math.min(200, int('blankCount', 0))),
    cropMarks: $<HTMLInputElement>('cropMarks').checked,
  };
  saveSettings();
  refresh();
}

writeForm();
for (const f of fields) {
  $(f).addEventListener('input', readForm);
  $(f).addEventListener('change', readForm);
}

// ---- CSV loading ----

const dropzone = $('dropzone');
const fileInput = $<HTMLInputElement>('file');

async function loadFile(file: File) {
  const text = decodeBytes(await file.arrayBuffer());
  const result = parseCsv(text);
  const notices = $('notices');
  notices.innerHTML = '';
  const addNotice = (msg: string, cls = '') => {
    const li = document.createElement('li');
    li.textContent = msg;
    if (cls) li.className = cls;
    notices.append(li);
  };
  if (result.error) {
    addNotice(result.error, 'error');
    attendees = [];
  } else {
    attendees = result.attendees;
    markUnsupported();
    result.notices.forEach((n) => addNotice(n));
    const flagged = attendees.filter((a) => a.issues.length).length;
    if (flagged) addNotice(`${flagged} row${flagged === 1 ? ' needs' : 's need'} a look; see the Check column.`, 'warn');
  }
  excluded.clear();
  previewLine = attendees[0]?.line ?? null;
  $('drop-title').textContent = file.name;
  $('drop-sub').textContent = `${attendees.length} attendees loaded. Drop another file to replace them.`;
  dropzone.classList.add('loaded');
  renderTable();
  refresh();
}

function markUnsupported() {
  if (!supportedChars) return;
  for (const a of attendees) {
    const bad = [...new Set([...(a.name + a.country)].filter((ch) => ch !== ' ' && !supportedChars!.has(ch.codePointAt(0)!)))];
    if (bad.length) a.issues.push(`Can't print: ${bad.join(' ')}`);
  }
}

fileInput.addEventListener('change', () => fileInput.files?.[0] && loadFile(fileInput.files[0]));
dropzone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropzone.classList.add('over');
});
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('over'));
dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropzone.classList.remove('over');
  const file = e.dataTransfer?.files[0];
  if (file) loadFile(file);
});

// ---- Table ----

function renderTable() {
  const tbody = $('rows');
  tbody.innerHTML = '';
  $('table-card').hidden = attendees.length === 0;
  for (const a of attendees) {
    const tr = document.createElement('tr');
    tr.dataset.line = String(a.line);
    if (a.line === previewLine) tr.classList.add('selected');
    if (excluded.has(a.line)) tr.classList.add('excluded');

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !excluded.has(a.line);
    cb.title = 'Include in PDF';
    cb.addEventListener('click', (e) => e.stopPropagation());
    cb.addEventListener('change', () => {
      if (cb.checked) excluded.delete(a.line);
      else excluded.add(a.line);
      tr.classList.toggle('excluded', !cb.checked);
      refresh();
    });

    const cells = [cb, String(a.line), a.name, a.country || '—', a.issues.join(' · ')];
    cells.forEach((c, i) => {
      const td = document.createElement('td');
      if (typeof c === 'string') td.textContent = c;
      else td.append(c);
      if (i === 4 && c) td.className = 'issue';
      tr.append(td);
    });
    tr.addEventListener('click', () => {
      previewLine = a.line;
      tbody.querySelector('.selected')?.classList.remove('selected');
      tr.classList.add('selected');
      schedulePreview();
    });
    tbody.append(tr);
  }
}

// ---- Output ----

function tagsToPrint(): (Person | null)[] {
  const list = attendees.filter((a) => !excluded.has(a.line));
  const cmp = (x: string, y: string) => x.localeCompare(y, undefined, { sensitivity: 'base' });
  if (settings.sort === 'name') list.sort((a, b) => cmp(a.name, b.name));
  if (settings.sort === 'country') list.sort((a, b) => cmp(a.country, b.country) || cmp(a.name, b.name));
  return [...list.map(({ name, country }) => ({ name, country })), ...Array<null>(settings.blankCount).fill(null)];
}

function refresh() {
  const tags = tagsToPrint();
  const layout = getLayout(settings.layoutId);
  const perPage = layout.cols * layout.rows;
  const pages = Math.ceil(tags.length / perPage);
  const pageName = layout.pageW === 210 ? 'A4' : layout.id === 'a6' ? 'A6' : 'card';
  $('summary').textContent = tags.length
    ? `${tags.length} tag${tags.length === 1 ? '' : 's'} · ${pages} ${pageName} page${pages === 1 ? '' : 's'}`
    : 'Load a CSV or add blank tags';
  $<HTMLButtonElement>('download').disabled = !assets || tags.length === 0;
  const frame = $('preview-frame');
  frame.style.aspectRatio = `${layout.tagW} / ${layout.tagH}`;
  frame.classList.toggle('portrait', layout.tagH > layout.tagW);
  schedulePreview();
}

let previewTimer: number | undefined;
let previewUrl: string | null = null;
let previewSeq = 0;

function schedulePreview() {
  clearTimeout(previewTimer);
  previewTimer = window.setTimeout(renderPreview, 200);
}

async function renderPreview() {
  if (!assets) return;
  const seq = ++previewSeq;
  const a = attendees.find((x) => x.line === previewLine);
  const person = a ? { name: a.name, country: a.country } : SAMPLE;
  $('preview-name').textContent = a ? a.name : 'Sample attendee';
  const bytes = await buildPreviewPdf(person, settings, assets);
  if (seq !== previewSeq) return;
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }));
  $<HTMLIFrameElement>('preview').src = `${previewUrl}#toolbar=0&navpanes=0&view=Fit`;
}

$('download').addEventListener('click', async () => {
  if (!assets) return;
  const btn = $<HTMLButtonElement>('download');
  btn.disabled = true;
  btn.textContent = 'Generating…';
  try {
    const bytes = await buildSheetPdf(tagsToPrint(), settings, assets);
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `PQP_name_tags_${settings.year}-${String(settings.month).padStart(2, '0')}.pdf`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  } catch (err) {
    alert(`Could not generate the PDF: ${err instanceof Error ? err.message : err}`);
  } finally {
    btn.textContent = 'Download PDF';
    btn.disabled = false;
  }
});

// ---- Boot ----

async function loadAssets() {
  const base = import.meta.env.BASE_URL;
  const get = async (path: string) => {
    const res = await fetch(base + path);
    if (!res.ok) throw new Error(`Missing ${path}`);
    return new Uint8Array(await res.arrayBuffer());
  };
  const [regular, semibold, bold, logo] = await Promise.all([
    get('fonts/NotoSans-Regular.ttf'),
    get('fonts/NotoSans-SemiBold.ttf'),
    get('fonts/NotoSans-Bold.ttf'),
    get('assets/cem-logo.png'),
  ]);
  assets = { regular, semibold, bold, logo };
  // Bold is what names are printed in, so check its character coverage.
  supportedChars = new Set(fontkit.create(bold).characterSet);
}

loadAssets()
  .then(refresh)
  .catch((err) => {
    $('summary').textContent = `Failed to load fonts/logo: ${err.message}`;
  });
