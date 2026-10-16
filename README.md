# PQP Name Tags

A browser app that turns a CSV or Excel list of attendees into a PDF of Council of European Muslims name tags, ready to print. Everything runs in the browser, so attendee data never leaves the computer.

## Use

```bash
npm install
npm run dev        # local development
npm run build      # static site in dist/ (host anywhere, e.g. GitHub Pages)
```

1. Drop in a CSV or Excel file (`.xlsx`, `.xls`, `.ods`) with `name` and `country` columns; files without both are rejected. `first_name` + `last_name` also count as a name column, and title rows above the header are fine. For Excel, the first worksheet is used. See `public/sample-attendees.csv`.
2. Set the class, month and year (saved in the browser for next time).
3. Pick a tag size and download the PDF. Print at **100% / Actual size**.

## Files

- `src/pdf.ts`: tag design and sheet layout (pdf-lib)
- `src/layouts.ts`: tag sizes and sheet grids
- `src/csv.ts`: CSV/Excel parsing and checks
- `public/assets/cem-logo.png`: replace with a higher-resolution logo (same filename) for sharper print
- `src/text.ts`: text shaping (HarfBuzz) and per-script font fallback, so names in any major script print correctly (Arabic, Hebrew, Cyrillic, Greek, Indic, Thai, Chinese, Japanese, Korean, …)
- `public/fonts/`: Noto Sans plus per-script Noto fonts in `scripts/`, downloaded by the browser only when a name needs them (SIL Open Font License)
