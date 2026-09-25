# Chary's DCB & LL — Refactored Structure

This package separates the original single HTML file by responsibility while preserving the existing UI, calculations, Firebase flow, and PDF generation behavior.

## Structure

- `index.html`
  - HTML/UI structure only.
  - No inline application JavaScript.
  - Uses the external stylesheet and JavaScript modules below.

### CSS

- `css/styles.css` — entry point; imports CSS in the original cascade order.
- `css/01-core.css` — common/base/table styling.
- `css/02-animations.css` — button/month animations and ripple effects.
- `css/03-pdf.css` — A4 print-safe rules and PDF table wrapping.
- `css/04-responsive-ui.css` — general responsive layout.
- `css/05-auth.css` — authentication modal/card base styles.
- `css/06-responsive-vo.css` — responsive VO/MS detail and data-management layouts.
- `css/07-auth-profile.css` — profile-specific UI.
- `css/08-vo-desktop.css` — desktop VO detail layout.
- `css/09-auth-password.css` — password/signup UI.
- `css/10-responsive-final.css` — final responsive/freeze overrides.
- `css/11-login-system.css` — VO/MS login selector UI.
- `css/pdf-print-window.css` — stylesheet used by the separate PDF print window.

### JavaScript

- `js/auth/firebase-auth.js`
  - Firebase initialization.
  - Firebase Auth session handling.
  - Firestore cloud read/write bridge.
  - Login session/inactivity handling.
- `js/modes/vo-mode.js`
  - VO-specific mode definition.
- `js/modes/ms-mode.js`
  - MS-specific mode definition.
- `js/modes/mode-config.js`
  - Shared mode resolver and dynamic labels.
  - MS-only Village hiding / District-required UI behavior remains selected by `currentMode === "MS"`.
- `js/app-core.js`
  - Shared accounting state.
  - VO/MS data operations.
  - Child/SHG table calculations and rendering.
  - Backup/restore.
  - Cloud-ready synchronization.
- `js/pdf/pdf-generator.js`
  - Monthly DCB PDF.
  - Cumulative DCB PDF.
  - Loan Ledger PDF.
  - Combined PDF.
  - PDF sizing/font/table-fit/page-layout logic.
- `js/auth/auth-ui.js`
  - Username/email login UI.
  - Signup.
  - Password reset.
  - Profile.
  - Register VO/MS access.
- `js/bootstrap.js`
  - Button/event wiring and final browser event setup.

## Important non-regression rules

1. VO and MS continue to use separate local-storage keys.
2. Firebase authentication remains the same.
3. Firebase/Firestore API behavior remains in `firebase-auth.js`.
4. PDF generation algorithms were not rewritten.
5. The PDF print window now loads `css/pdf-print-window.css` instead of embedding the same static print CSS inside the JavaScript template.
6. The two duplicate `firebase-cloud-ready` listeners were merged into one equivalent listener.
7. The duplicated login Enter-key handlers were reduced to one binding.
8. MS-specific UI behavior remains isolated to MS mode; VO behavior is not intentionally changed.

## Run

Serve the folder from the same web host/path used for the existing application so Firebase and the external PDF print stylesheet resolve normally.
