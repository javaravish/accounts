# Chary's DCB & Loan Ledger — separated project

This is a **safe structural refactor** of the supplied single-file application. Runtime logic, DOM IDs, Firebase configuration, authentication flow, report/PDF functions, and generated PDF markup were preserved.

## Structure
- `index.html` — page markup only
- `css/01-base.css` — original base styles
- `css/02-layout-and-auth-ui.css` — toolbar, responsive, authentication/profile UI styles
- `css/03-report-preview.css` — Report Center preview styles
- `css/04-login-and-app-shell.css` — login/application header/footer styles
- `css/05-pdf-and-report-print.css` — PDF/print/report geometry styles
- `css/06-final-layout-overrides.css` — final UI override cascade
- `js/auth/firebase-auth.js` — Firebase initialization, authentication, registration/access, profile flows
- `js/app.js` — main dashboard/application controller (including existing report/PDF implementation)
- `js/auth/login-fallback.js` — independent login-page fallback wiring

## PDF/report safety
The PDF generation code and its print-window HTML/CSS were not rewritten. They remain byte-for-byte equivalent to the supplied application inside `js/app.js`; only the surrounding file boundaries changed.

## Why PDF/report logic remains in app.js
The original PDF and Report Center functions share private state and helpers inside the large dashboard IIFE. Moving those functions into separate runtime modules would require changing their dependency model, which risks changing PDF output or functionality. This refactor therefore separates the high-risk independent boundaries first while preserving the existing PDF/report implementation exactly.
