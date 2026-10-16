# PQP Name Tags

A browser app that turns a CSV of attendees into a PDF of Council of European Muslims name tags, ready to print. Everything runs in the browser, so attendee data never leaves the computer.

## Use

```bash
npm install
npm run dev        # local development
npm run build      # static site in dist/ (host anywhere, e.g. GitHub Pages)
```

1. Drop in a CSV with `name` and `country` columns. `first_name` + `last_name`, semicolon separators and Excel exports also work. See `public/sample-attendees.csv`.
2. Set the class, month and year (saved in the browser for next time).
3. Pick a tag size and download the PDF. Print at **100% / Actual size**.

## Files

- `src/pdf.ts`: tag design and sheet layout (pdf-lib)
- `src/layouts.ts`: tag sizes and sheet grids
- `src/csv.ts`: CSV parsing and checks
- `public/assets/cem-logo.png`: replace with a higher-resolution logo (same filename) for sharper print
- `public/fonts/`: Noto Sans (SIL Open Font License)
