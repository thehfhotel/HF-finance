# Changelog

All notable changes to this project are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.11.0] - 2026-07-06

### Added
- **Company expense ledger (บัญชีรายจ่ายบริษัท).** New ADMIN role for the office admin, with a
  kiosk-style one-question-per-screen wizard (บันทึกบิล) for entering paper invoices: photo → amount →
  P&L category (with per-building variants: สายชล / Hop inn 47 / HF Ville) → payment method → confirm.
  "พนักงานจ่ายไปก่อน" creates a reimbursement Receipt for the chosen employee, so staff-paid invoices
  enter the normal bundle → approve → pay flow and still roll up into the ledger.
- **Month dashboard** (รายจ่ายบริษัท): per-line totals combining admin bills + reimbursement receipts
  (mapped via the shared category → P&L-line table), a recurring-bill completeness checklist
  (missing ไฟฟ้า/น้ำ/โทรศัพท์/ประกันสังคม… flagged per month), and the raw entry list with unpaid
  (ค้างจ่าย) badges.
- **Monthly งบกำไรขาดทุน report** in the accountant's paper-sheet layout with print/PDF. Months up to
  2026-06 render the static transcription of the accountant's sheets (30 months, arithmetic-verified);
  later months compute live from the ledger with admin-editable revenue figures.
- Schema: `expenses` + `revenue_entries` tables, `Role.ADMIN` (additive migration applied on deploy).

## [0.10.0] - 2026-06-17

### Added
- **Mobile bottom navigation** (role-aware, persistent on top-level screens): employees get คำขอ / เพิ่ม;
  approvers get กล่องอนุมัติ / คำขอของฉัน / พนักงาน — making admin and "my requests" reachable on mobile.
- **Rejected (ปฏิเสธ) tab** on the mobile inbox.
- **Mobile-friendly admin**: the employee manager renders as stacked cards with bottom-sheet modals on phones
  (the table layout is kept on desktop).

## [0.9.0] - 2026-06-17

### Changed
- **Status colors.** pending / approved / paid / rejected now have distinct, calm hues (separate from the
  burnt-orange brand accent), applied via `StatusPill`, so states read at a glance.
- **Typography.** Refined system font stack for display/UI text and a real monospace for reference codes;
  amounts use tabular figures.

## [0.8.0] - 2026-06-17

### Added
- **Reject with a reason.** Approvers can include an optional reason when rejecting a request (entered in the
  reject confirm dialog); the submitter sees "เหตุผลที่ปฏิเสธ: …" on the rejected bundle. Adds a nullable
  `rejectReason` column (additive migration applied on deploy).

## [0.7.0] - 2026-06-17

### Added
- **Edit and delete draft receipts.** A draft (un-bundled) receipt can be edited — the form reopens prefilled and
  keeps the existing photo unless you pick a new one — or deleted via a confirm dialog (mobile RecordDetail +
  desktop receipt cards). Already-bundled receipts stay locked.

## [0.6.0] - 2026-06-17

### Added
- Shared `EmptyState` + `Toast` components; success toasts after creating a receipt, submitting a bundle,
  approving, and paying.

### Changed
- Auth screens (login / account-linking) are centered on desktop instead of full-bleed; linking now shows a
  success state, clears the code on error, and offers an actionable admin-contact link for "no account / expired code".
- Unified the app's empty states to one `EmptyState` vocabulary.
- Copy: submit verb unified to "ส่งขออนุมัติ"; the bundle name now defaults to an auto-generated "คำขอ <date>"
  placeholder instead of a fixed string.

## [0.5.0] - 2026-06-17

### Added
- **Confirmation dialogs before approving, rejecting, and paying** — money actions now require an explicit
  confirm (new shared `ConfirmDialog`), preventing costly mis-taps.
- **Editable receipt date** (defaults to today, capped at today) on both the mobile and desktop create flows.

### Changed
- The receipt-photo **lightbox** is now a true full-viewport overlay with tap-to-zoom, prev/next, keyboard
  control (Esc / ← / →), a visible close button, and a "ไม่มีรูปใบเสร็จ" fallback when a receipt has no photo.

## [0.4.0] - 2026-06-17

### Added
- **Photo upload now offers the photo library + files, not just the camera** — removed the forced
  `capture="environment"`, so the OS picker shows Take Photo / Photo Library / Choose File.

### Changed (UX pass — P0 quick wins)
- Error + busy/disabled states on every money action (approve / reject / pay / create-receipt / submit-bundle):
  failures now surface inline and double-submits are prevented.
- Removed misleading/dead controls: the fake payee bank account on the pay screen and the no-op "ขอข้อมูลเพิ่ม" button.
- Accessibility: WCAG-AA contrast for soft text, a global focus-visible ring, 44px tap targets for icon buttons.
- Linking-code expiry shows relative time ("หมดอายุในอีก N ชม.") instead of only a date.
- Single-receipt → bundle path is reachable; "add to bundle" preselects only that receipt.
- Amount inputs accept at most one decimal point + 2 fraction digits; payment reference is trimmed.
- Employee initials auto-derive from name; inbox stat cards switch tabs; approver list rows show a chevron.
- Dropped the synthetic "รายการที่ถ่าย" line item from new receipts.

## [0.3.1] - 2026-06-17

### Fixed
- Mobile action bars (save / submit / approve / pay) used `position: absolute` inside the scrolling
  container, so they drifted up while scrolling and overlapped form fields (e.g. the save button covering
  the ที่พัก property selector). Changed to `position: sticky` so they stay pinned to the bottom — across
  Upload, BundleBuilder, Review, and Pay.

## [0.3.0] - 2026-06-16

### Added
- **Approvers can create their own reimbursement requests** ("คำขอของฉัน" / My requests). An approver keeps
  their approval inbox and gains an opt-in entry — a desktop sidebar item and a mobile Inbox AppBar action —
  into the full requestor flow, with a back-to-inbox affordance. Their requestor view is scoped to their own
  data via a new server-side `?mine=1` param on `GET /receipts` and `GET /bundles`, loaded into a separate client
  state slice (no other users' rows are sent to the browser). Self-approval is allowed, so a single-approver org
  is never a dead-end.

### Fixed
- Newly created receipts now use today's date instead of the hardcoded `2026-04-30`.

## [0.2.2] - 2026-06-16

### Changed
- **Desktop layout polish ("centered editorial").** Detail content is now capped at 840px and centered
  (`margin: 0 auto`) within wide panes instead of hugging the left edge; the employee drafts gallery caps
  at 1040px. Empty states became a centered icon-chip + display heading + subtext (replacing lone floating
  labels, the bare "ไม่มีรายการ", and the 📸 emoji), applied consistently across the approver and employee
  desktop views. No functional/route/data changes.

## [0.2.1] - 2026-06-16

### Fixed
- **Desktop layout now fills the full viewport.** The desktop shell was subject to
  index.html's centered, padded, dark-gradient `body` (a backdrop intended only for the
  dev phone-mockup preview), which shrink-wrapped the layout and left dark margins on wide
  screens. The shell is now pinned with `position: fixed; inset: 0`, so desktop mode always
  uses the entire browser window.

## [0.2.0] - 2026-06-16

Production-correctness pass. The app was already a near-complete build with a working
deploy pipeline, but it rendered inside a dev-only phone-frame mockup and lacked a few
money-handling guards. This release makes it correct on real devices and safe for live
reimbursements.

### Fixed
- **Responsive layout.** Production picked a hardcoded "mobile" platform and wrapped the
  whole UI in a dev-only iPhone frame, so desktop browsers showed a tiny phone in a black
  void and the existing desktop layouts were unreachable. The layout is now chosen from the
  viewport width — desktops get the desktop layout, phones render full-bleed; the phone
  frame is dev-preview only.
- **Bundle list missing receipts.** `GET /bundles` omitted receipts (and the approver),
  which would crash the inbox/home once any real bundle existed. List responses are now full
  bundle details.
- **Hardcoded identity.** Mobile headers, the desktop sidebar footer, and the submission screens
  showed placeholder names/initials ("ก. พล", "มายา"), and the desktop screens resolved
  approver/submitter names from a hardcoded seed map. Names/initials now come from the live API /
  logged-in user; employee-facing copy refers to "ฝ่ายการเงิน" rather than a fixed person.
- **Stale HTML after deploy.** `index.html` carried no cache directive, so browsers kept serving
  the previous bundle after a deploy. It is now sent `no-cache` (hashed assets stay immutable),
  so deploys reach returning users.

### Added
- Viewport-based platform detection (`useViewportPlatform`).
- Bundle state-machine guards: approve/reject require a pending bundle, pay requires an
  approved bundle (HTTP 409 otherwise).
- Submitter/approver display names + initials in the bundle API contract.

### Changed
- CORS is restricted to the configured web origin (`WEB_BASE_URL`) in production.

### Security
- The dev `X-Dev-User-Id` impersonation header is honored only when `NODE_ENV=development`;
  it fails closed when `NODE_ENV` is unset or set to anything else.

### Removed
- Non-functional placeholder controls (filter, notification bell, "more" menus, and the
  static "view all" link).

## [0.1.0] - 2026-05-05

- Initial reimbursement-v2 build (Bun + Elysia + Prisma + React): receipts, bundles,
  approvals, payments, admin employee management, and LINE OAuth account linking.
