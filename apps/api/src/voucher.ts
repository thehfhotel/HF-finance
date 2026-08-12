import type {
  Bundle as PrismaBundle,
  Receipt as PrismaReceipt,
  User as PrismaUser,
} from './generated/prisma';

/**
 * The Thai payment voucher (ใบสรุปการจ่ายคืน) attached to a KBIZ transfer.
 *
 * Rendered here as HTML rather than PDF on purpose: this is a Thai-first web
 * app, so the browser that already ships with kbiz-bot does the shaping — Thai
 * combining vowels and tone marks are exactly where headless PDF libraries
 * fall apart. The bot converts this file with its own Chromium and attaches the
 * result to the transfer (ADR 0001, decision 8).
 *
 * Text-only, deliberately: no receipt photos. The voucher rides along on a bank
 * transfer, and the photos already live in the app behind the Cloudflare
 * identity gate. Keeping it text keeps the attachment small and the document
 * readable on a bank statement archive years from now.
 *
 * Self-contained by necessity — the bot renders it from a file with no network
 * and no asset directory, so every style is inline and every font is a system
 * font.
 */

const THAI_MONTHS = [
  'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
  'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.',
];

/** `2026-08-12` / a Date → `12 ส.ค. 2569` (Buddhist era, as printed in Thailand). */
function formatThaiDate(value: string | Date | null | undefined): string {
  if (!value) return '—';

  let year: number;
  let monthIndex: number;
  let day: number;

  if (typeof value === 'string') {
    const [y, m, d] = value.slice(0, 10).split('-');
    year = Number(y);
    monthIndex = Number(m) - 1;
    day = Number(d);
  } else {
    year = value.getFullYear();
    monthIndex = value.getMonth();
    day = value.getDate();
  }

  if (!Number.isFinite(year) || !Number.isFinite(day) || !THAI_MONTHS[monthIndex]) {
    return typeof value === 'string' ? value : '—';
  }
  return `${day} ${THAI_MONTHS[monthIndex]} ${year + 543}`;
}

/** `฿1,234.56` — comma-grouped, always two decimals, same as the web app's `fmt`. */
function formatBaht(amount: number): string {
  const [whole, fraction] = Math.abs(amount).toFixed(2).split('.');
  return `฿${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${fraction}`;
}

/**
 * The handle an approver reads back off a bank statement — the same six
 * characters `buildKbizMemo` puts in the transfer memo, so the voucher and the
 * bank line can be matched by eye.
 */
function shortBundleId(bundleId: string): string {
  return bundleId.slice(-6).toUpperCase();
}

/** Everything interpolated below is user-entered text; none of it is markup. */
function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

const FONT_STACK = "'Sarabun', 'Noto Sans Thai', 'Leelawadee UI', 'Tahoma', sans-serif";

export function renderVoucherHtml(
  bundle: PrismaBundle,
  receipts: PrismaReceipt[],
  user: PrismaUser,
  approver: PrismaUser | null,
): string {
  const total = receipts.reduce((sum, receipt) => sum + Number(receipt.amount), 0);
  const rows = receipts
    .map(
      (receipt) => `
        <tr>
          <td style="padding:8px 10px;border-bottom:1px solid #EDE7DD;white-space:nowrap;">${escapeHtml(formatThaiDate(receipt.date))}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #EDE7DD;">${escapeHtml(receipt.category)}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #EDE7DD;">${escapeHtml(receipt.merchant)}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #EDE7DD;text-align:right;white-space:nowrap;">${escapeHtml(formatBaht(Number(receipt.amount)))}</td>
        </tr>`,
    )
    .join('');

  const field = (label: string, value: string) => `
        <tr>
          <td style="padding:4px 16px 4px 0;color:#7A7168;white-space:nowrap;vertical-align:top;">${escapeHtml(label)}</td>
          <td style="padding:4px 0;color:#241F1A;font-weight:600;">${escapeHtml(value)}</td>
        </tr>`;

  return `<!doctype html>
<html lang="th">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ใบสรุปการจ่ายคืน ${escapeHtml(shortBundleId(bundle.id))}</title>
</head>
<body style="margin:0;padding:32px;background:#FFFFFF;color:#241F1A;font-family:${FONT_STACK};font-size:14px;line-height:1.6;">
  <div style="max-width:720px;margin:0 auto;">

    <div style="border-bottom:2px solid #7E5E3A;padding-bottom:12px;margin-bottom:20px;">
      <div style="font-size:22px;font-weight:700;color:#7E5E3A;">ใบสรุปการจ่ายคืน</div>
      <div style="font-size:12px;color:#7A7168;">ระบบเบิกค่าใช้จ่าย HF Hotel &amp; HF Ville</div>
    </div>

    <table style="border-collapse:collapse;margin-bottom:24px;">
      ${field('ผู้รับเงิน', user.name)}
      ${field('ชื่อคำขอ', `${bundle.name} (${shortBundleId(bundle.id)})`)}
      ${field('วันที่', formatThaiDate(new Date()))}
    </table>

    <table style="width:100%;border-collapse:collapse;font-size:13px;">
      <thead>
        <tr style="background:#F5EBD9;color:#5C4630;">
          <th style="padding:8px 10px;text-align:left;font-weight:600;white-space:nowrap;">วันที่</th>
          <th style="padding:8px 10px;text-align:left;font-weight:600;">หมวดหมู่</th>
          <th style="padding:8px 10px;text-align:left;font-weight:600;">ร้านค้า</th>
          <th style="padding:8px 10px;text-align:right;font-weight:600;white-space:nowrap;">จำนวนเงิน</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
      <tfoot>
        <tr>
          <td colspan="3" style="padding:12px 10px;text-align:right;font-weight:700;">ยอดรวม</td>
          <td style="padding:12px 10px;text-align:right;font-weight:700;font-size:16px;white-space:nowrap;">${escapeHtml(formatBaht(total))}</td>
        </tr>
      </tfoot>
    </table>

    <table style="border-collapse:collapse;margin-top:28px;">
      ${field('ผู้อนุมัติ', approver ? approver.name : '—')}
      ${field('วันที่อนุมัติ', formatThaiDate(bundle.approvedAt))}
    </table>

  </div>
</body>
</html>
`;
}
