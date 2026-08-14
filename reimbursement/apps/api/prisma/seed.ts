/**
 * Prisma seed script — mirrors frontend mock data in apps/web/src/lib/sampleData.ts.
 *
 * Re-runnable: every record uses upsert keyed on a stable id, so running this
 * seed twice produces the same database state. Wrapped in a transaction so
 * partial failure leaves the DB untouched.
 *
 * Run with: bun run db:seed
 */

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';

// .env lives at the repo root (../../../.env from this file).
loadEnv({ path: resolve(import.meta.dirname, '../../../.env') });

import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  PrismaClient,
  Role,
  BundleStatus,
} from '../src/generated/prisma/index.js';

type ReceiptItem = readonly [label: string, value: string];

interface UserSeed {
  readonly id: string;
  readonly name: string;
  readonly role: Role;
  readonly initials: string;
}

interface ReceiptSeed {
  readonly id: string;
  readonly userId: string;
  readonly merchant: string;
  readonly category: string;
  readonly amount: number;
  readonly date: string;
  readonly note: string;
  readonly color: string;
  readonly accent: string;
  readonly items: readonly ReceiptItem[];
  readonly tax: string;
}

interface BundleSeed {
  readonly id: string;
  readonly userId: string;
  readonly name: string;
  readonly status: BundleStatus;
  readonly submittedAt: Date;
  readonly note: string;
  readonly receiptIds: readonly string[];
  readonly approvedAt?: Date;
  readonly approvedById?: string;
  readonly paidAt?: Date;
  readonly transferRef?: string;
  readonly transferAmount?: number;
}

const USERS: readonly UserSeed[] = [
  { id: 'user_maya',  name: 'มายา จ.',   role: Role.EMPLOYEE, initials: 'มย' },
  { id: 'user_niran', name: 'นิรันดร์ ก.', role: Role.EMPLOYEE, initials: 'นร' },
  { id: 'user_kpol',  name: 'ก. พล',     role: Role.APPROVER, initials: 'กพ' },
  { id: 'user_som',   name: 'สม พ.',     role: Role.EMPLOYEE, initials: 'สพ' },
  { id: 'user_mai',   name: 'ใหม่ ท.',   role: Role.EMPLOYEE, initials: 'มท' },
];

// Six receipts owned by user_niran, mirroring SAMPLE_RECEIPTS.
const NIRAN_RECEIPTS: readonly ReceiptSeed[] = [
  {
    id: 'r1',
    userId: 'user_niran',
    merchant: 'วิลล่า มาร์เก็ต',
    category: 'ต้นทุนอาหารเช้า HF',
    amount: 2840,
    date: '2026-04-22',
    note: 'อาหารเช้าบุฟเฟ่ต์ — ไข่ ขนมปัง ผลไม้',
    color: '#F5EBD9',
    accent: '#7E5E3A',
    items: [
      ['ไข่ไก่ · 10 แผง', '950'],
      ['ขนมปังซาวร์โดว์', '720'],
      ['ผลไม้ตามฤดูกาล', '880'],
      ['เนย & แยม', '290'],
    ],
    tax: '0',
  },
  {
    id: 'r2',
    userId: 'user_niran',
    merchant: 'โฮมโปร',
    category: 'อุปกรณ์ช่าง',
    amount: 1620,
    date: '2026-04-22',
    note: 'หลอดไฟทางเดิน ชั้น 2',
    color: '#FFE9D6',
    accent: '#A04A1A',
    items: [
      ['หลอดดาวน์ไลท์ LED ×8', '1,280'],
      ['ไดรเวอร์เปลี่ยน', '240'],
      ['VAT 7%', '100'],
    ],
    tax: '100',
  },
  {
    id: 'r3',
    userId: 'user_niran',
    merchant: 'ปตท. แก๊ส',
    category: 'อื่น ๆ',
    amount: 4250,
    date: '2026-04-21',
    note: 'แก๊ส LPG — เครื่องอบผ้า',
    color: '#1F2937',
    accent: '#E8C57A',
    items: [
      ['LPG · ถัง 48 กก. ×2', '3,950'],
      ['ค่าจัดส่ง', '300'],
    ],
    tax: '0',
  },
  {
    id: 'r4',
    userId: 'user_niran',
    merchant: 'แม็คโคร',
    category: 'อุปกรณ์แม่บ้าน',
    amount: 3180,
    date: '2026-04-20',
    note: 'ผ้าและของใช้ในห้องพัก',
    color: '#E8F0F4',
    accent: '#1A4A6E',
    items: [
      ['ผ้าขนหนู ×24', '1,680'],
      ['แชมพูขวดเล็ก ×60', '900'],
      ['ผงซักฟอก', '600'],
    ],
    tax: '0',
  },
  {
    id: 'r5',
    userId: 'user_niran',
    merchant: 'ท็อปส์ เดลี่',
    category: 'บาร์น้ำ',
    amount: 1240,
    date: '2026-04-19',
    note: 'กาแฟ ชา และของบริการ',
    color: '#EDE3D2',
    accent: '#5A3A1A',
    items: [
      ['เมล็ดกาแฟ · 2 กก.', '780'],
      ['ชาคัดสรร', '320'],
      ['VAT 7%', '140'],
    ],
    tax: '140',
  },
  {
    id: 'r6',
    userId: 'user_niran',
    merchant: 'แกร็บ',
    category: 'อื่น ๆ',
    amount: 480,
    date: '2026-04-18',
    note: 'รับ-ส่งพนักงาน กะดึก',
    color: '#E6F4EA',
    accent: '#0A6E40',
    items: [
      ['ระยะ 14 กม.', '420'],
      ['ค่าบริการ', '60'],
    ],
    tax: '0',
  },
];

// Cloned receipts owned by other employees so APPROVER_INBOX_EXTRA bundles
// have receipts they actually own (rather than reusing user_niran's).
const CLONED_RECEIPTS: readonly ReceiptSeed[] = [
  // r3b/r4b — clones of r3 and r4 owned by user_som for bundle b10
  { ...findReceipt('r3'), id: 'r3b', userId: 'user_som' },
  { ...findReceipt('r4'), id: 'r4b', userId: 'user_som' },
  // r1b — clone of r1 owned by user_mai for bundle b11
  { ...findReceipt('r1'), id: 'r1b', userId: 'user_mai' },
];

function findReceipt(id: string): ReceiptSeed {
  const receipt = NIRAN_RECEIPTS.find((r) => r.id === id);
  if (!receipt) {
    throw new Error(`Seed misconfiguration: receipt ${id} not found`);
  }
  return receipt;
}

const ALL_RECEIPTS: readonly ReceiptSeed[] = [...NIRAN_RECEIPTS, ...CLONED_RECEIPTS];

const BUNDLES: readonly BundleSeed[] = [
  {
    id: 'b1',
    userId: 'user_niran',
    name: 'ซ่อมบำรุง — สัปดาห์ที่ 4',
    status: BundleStatus.PENDING,
    submittedAt: new Date('2026-04-23T00:00:00.000Z'),
    note: 'หลอดไฟทางเดิน + แก๊สเครื่องอบผ้า',
    receiptIds: ['r2', 'r3'],
  },
  {
    id: 'b2',
    userId: 'user_niran',
    name: 'เติมของอาหารเช้า',
    status: BundleStatus.APPROVED,
    submittedAt: new Date('2026-04-20T00:00:00.000Z'),
    note: '',
    receiptIds: ['r1', 'r5'],
    approvedAt: new Date('2026-04-21T00:00:00.000Z'),
    approvedById: 'user_kpol',
  },
  {
    id: 'b3',
    userId: 'user_niran',
    name: 'แม่บ้าน — ไตรมาส 2',
    status: BundleStatus.PAID,
    submittedAt: new Date('2026-04-15T00:00:00.000Z'),
    note: '',
    receiptIds: ['r4'],
    approvedAt: new Date('2026-04-16T00:00:00.000Z'),
    approvedById: 'user_kpol',
    paidAt: new Date('2026-04-17T00:00:00.000Z'),
    transferRef: 'SCB-887214-AB',
    transferAmount: 3180,
  },
  {
    id: 'b10',
    userId: 'user_som',
    name: 'สารเคมีสระว่ายน้ำ',
    status: BundleStatus.PENDING,
    submittedAt: new Date('2026-04-24T00:00:00.000Z'),
    note: 'คลอรีน + อะไหล่เครื่องกรองรายเดือน',
    receiptIds: ['r3b', 'r4b'],
  },
  {
    id: 'b11',
    userId: 'user_mai',
    name: 'F&B — รายสัปดาห์',
    status: BundleStatus.PENDING,
    submittedAt: new Date('2026-04-23T00:00:00.000Z'),
    note: '',
    receiptIds: ['r1b'],
  },
];

// ─── ภาพรวม fixtures ──────────────────────────────────────────────────────
//
// Anchored to the clock at seed time rather than to fixed calendar dates, so
// the day / week / month windows and their prior-period comparisons are always
// populated however long after this file was written the seed is run.
//
// Merchant strings REPEAT across bundles, properties and dates on purpose:
// ตามร้านค้า and ตามหมวดหมู่ are ranked breakdowns, and a dataset where every
// receipt is a unique shop ranks nothing. Two spellings of one shop
// ("แม็คโคร กระบี่" with and without stray whitespace) are here to prove the
// vendor_normalize() fold, and one blank merchant to prove it yields no vendor.

const NOW = new Date();
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
/** Thailand is UTC+7 year-round — no DST, so this offset is exact. */
const BKK_OFFSET_MS = 7 * HOUR_MS;

function minutesAgo(n: number): Date {
  return new Date(NOW.getTime() - n * MINUTE_MS);
}

function daysAgo(n: number): Date {
  return new Date(NOW.getTime() - n * DAY_MS);
}

/** Today's Bangkok calendar date, as UTC-shifted parts. */
function bangkokToday(): { y: number; m: number; d: number } {
  const shifted = new Date(NOW.getTime() + BKK_OFFSET_MS);
  return {
    y: shifted.getUTCFullYear(),
    m: shifted.getUTCMonth() + 1,
    d: shifted.getUTCDate(),
  };
}

/** An instant at a given Bangkok wall-clock time on a given Bangkok date. */
function bangkokInstant(y: number, m: number, d: number, hh: number, mi: number): Date {
  return new Date(Date.UTC(y, m - 1, d, hh, mi) - BKK_OFFSET_MS);
}

/**
 * A payment whose Bangkok day and UTC day DISAGREE — the regression fixture for
 * the timezone bug. 06:30 Bangkok is 23:30 UTC the previous day, so any query
 * that truncates the raw column files it under yesterday. Clamped to just
 * before now so it is never a future payment when the seed runs before dawn.
 */
function earlyMorningPayment(): Date {
  const today = bangkokToday();
  const target = bangkokInstant(today.y, today.m, today.d, 6, 30);
  return target.getTime() < NOW.getTime() ? target : minutesAgo(5);
}

/** 00:30 Bangkok on the 1st of last month — inside every clamped prev-month range. */
function lastMonthPayment(): Date {
  const today = bangkokToday();
  const month = today.m === 1 ? 12 : today.m - 1;
  const year = today.m === 1 ? today.y - 1 : today.y;
  return bangkokInstant(year, month, 1, 0, 30);
}

interface OverviewReceiptSeed {
  readonly id: string;
  readonly userId: string;
  readonly merchant: string;
  readonly category: string;
  readonly property: string;
  readonly amount: number;
  readonly date: string;
}

interface OverviewBundleSeed {
  readonly id: string;
  readonly userId: string;
  readonly name: string;
  readonly status: BundleStatus;
  readonly submittedAt: Date;
  readonly approvedAt?: Date;
  readonly paidAt?: Date;
  readonly payingSince?: Date;
  readonly paymentError?: string;
  readonly rejectReason?: string;
  readonly transferRef?: string;
  readonly receipts: ReadonlyArray<{
    readonly merchant: string;
    readonly category: string;
    readonly property: string;
    readonly amount: number;
  }>;
}

function isoDay(at: Date): string {
  return new Date(at.getTime() + BKK_OFFSET_MS).toISOString().slice(0, 10);
}

const OVERVIEW_BUNDLES: readonly OverviewBundleSeed[] = [
  // ── paid: today (both sides of the Bangkok/UTC day boundary) ───────────
  {
    id: 'ov_paid_dawn',
    userId: 'user_niran',
    name: 'ของสดเช้าตรู่',
    status: BundleStatus.PAID,
    submittedAt: daysAgo(3),
    approvedAt: daysAgo(2),
    paidAt: earlyMorningPayment(),
    transferRef: 'KB-770145-AA',
    receipts: [
      { merchant: 'แม็คโคร กระบี่', category: 'ต้นทุนอาหารเช้า HF', property: 'hf-hotel', amount: 4820 },
      { merchant: 'วิลล่า มาร์เก็ต', category: 'ต้นทุนอาหารเช้า HF', property: 'hf-hotel', amount: 1960 },
    ],
  },
  {
    id: 'ov_paid_today',
    userId: 'user_som',
    name: 'ของใช้ห้องพัก',
    status: BundleStatus.PAID,
    submittedAt: daysAgo(4),
    approvedAt: daysAgo(1),
    // Settled through KBIZ, so it carries the payingSince the ธนาคาร speed
    // metric measures against — that metric counts only automated transfers.
    payingSince: minutesAgo(99),
    paidAt: minutesAgo(95),
    transferRef: 'KB-770146-AB',
    receipts: [
      { merchant: '  แม็คโคร   กระบี่ ', category: 'อุปกรณ์แม่บ้าน', property: 'hf-ville', amount: 3240 },
      { merchant: 'โฮมโปร', category: 'อุปกรณ์โรงแรม', property: 'hf-ville', amount: 2180 },
    ],
  },
  // ── paid: earlier this week ────────────────────────────────────────────
  {
    id: 'ov_paid_d1',
    userId: 'user_mai',
    name: 'บาร์น้ำ — เติมของ',
    status: BundleStatus.PAID,
    submittedAt: daysAgo(5),
    approvedAt: daysAgo(2),
    payingSince: new Date(daysAgo(1).getTime() - 4 * MINUTE_MS),
    paidAt: daysAgo(1),
    transferRef: 'KB-770131-AC',
    receipts: [
      { merchant: 'ท็อปส์ เดลี่', category: 'บาร์น้ำ', property: 'hf-hotel', amount: 1480 },
      { merchant: 'แม็คโคร กระบี่', category: 'บาร์น้ำ', property: 'hf-hotel', amount: 2260 },
    ],
  },
  {
    id: 'ov_paid_d2',
    userId: 'user_niran',
    name: 'ซ่อมปั๊มน้ำ อาคาร B',
    status: BundleStatus.PAID,
    submittedAt: daysAgo(6),
    approvedAt: daysAgo(3),
    payingSince: new Date(daysAgo(2).getTime() - 11 * MINUTE_MS),
    paidAt: daysAgo(2),
    transferRef: 'KB-770118-AD',
    receipts: [
      { merchant: 'ไทวัสดุ', category: 'อุปกรณ์ช่าง', property: 'hf-ville', amount: 5640 },
      { merchant: 'โฮมโปร', category: 'อุปกรณ์ช่าง', property: 'hf-hotel', amount: 1120 },
    ],
  },
  {
    id: 'ov_paid_d4',
    userId: 'user_som',
    name: 'ผ้าปูและปลอกหมอน',
    status: BundleStatus.PAID,
    submittedAt: daysAgo(9),
    approvedAt: daysAgo(5),
    paidAt: daysAgo(4),
    transferRef: 'KB-770092-AE',
    receipts: [
      { merchant: 'แม็คโคร กระบี่', category: 'อุปกรณ์แม่บ้าน', property: 'hf-hotel', amount: 7310 },
    ],
  },
  // ── paid: earlier this month ───────────────────────────────────────────
  {
    id: 'ov_paid_d9',
    userId: 'user_mai',
    name: 'โรงซักผ้า — น้ำยา',
    status: BundleStatus.PAID,
    submittedAt: daysAgo(14),
    approvedAt: daysAgo(11),
    paidAt: daysAgo(9),
    transferRef: 'KB-769980-AF',
    receipts: [
      { merchant: 'ปตท. แก๊ส', category: 'โรงซักผ้า', property: 'hf-ville', amount: 4250 },
      { merchant: 'ไทวัสดุ', category: 'โรงซักผ้า', property: 'hf-ville', amount: 980 },
    ],
  },
  {
    id: 'ov_paid_d12',
    userId: 'user_niran',
    name: 'สำนักงาน — เครื่องเขียน',
    status: BundleStatus.PAID,
    submittedAt: daysAgo(17),
    approvedAt: daysAgo(14),
    paidAt: daysAgo(12),
    transferRef: 'KB-769901-AG',
    receipts: [
      { merchant: 'ออฟฟิศเมท', category: 'อุปกรณ์สำนักงาน office', property: 'hf-hotel', amount: 1870 },
    ],
  },
  // ── paid: last month, for the like-for-like comparison ─────────────────
  {
    id: 'ov_paid_prev',
    userId: 'user_som',
    name: 'ของใช้ประจำเดือนก่อน',
    status: BundleStatus.PAID,
    submittedAt: new Date(lastMonthPayment().getTime() - 3 * DAY_MS),
    approvedAt: new Date(lastMonthPayment().getTime() - DAY_MS),
    paidAt: lastMonthPayment(),
    transferRef: 'KB-768220-AH',
    receipts: [
      { merchant: 'แม็คโคร กระบี่', category: 'อุปกรณ์โรงแรม', property: 'hf-hotel', amount: 9120 },
      { merchant: 'ท็อปส์ เดลี่', category: 'บาร์น้ำ', property: 'hf-ville', amount: 2410 },
    ],
  },

  // ── pending: one per age band (b1 ≤1 · b2 2–3 · b3 4–6 · b4 7+) ────────
  {
    id: 'ov_pend_b1',
    userId: 'user_maya',
    name: 'ค่าเดินทางส่งเอกสาร',
    status: BundleStatus.PENDING,
    submittedAt: minutesAgo(200),
    receipts: [{ merchant: 'แกร็บ', category: 'อื่น ๆ', property: 'hf-hotel', amount: 640 }],
  },
  {
    id: 'ov_pend_b2',
    userId: 'user_mai',
    name: 'อุปกรณ์ทำความสะอาด',
    status: BundleStatus.PENDING,
    submittedAt: daysAgo(3),
    receipts: [
      { merchant: 'โฮมโปร', category: 'อุปกรณ์แม่บ้าน', property: 'hf-ville', amount: 2140 },
    ],
  },
  {
    id: 'ov_pend_b3',
    userId: 'user_som',
    name: 'หลอดไฟและปลั๊ก',
    status: BundleStatus.PENDING,
    submittedAt: daysAgo(5),
    receipts: [{ merchant: 'ไทวัสดุ', category: 'อุปกรณ์ช่าง', property: 'hf-hotel', amount: 1760 }],
  },
  {
    id: 'ov_pend_b4',
    userId: 'user_niran',
    name: 'ร้านอาทิตย์ — ค้างนาน',
    status: BundleStatus.PENDING,
    submittedAt: daysAgo(11),
    receipts: [
      { merchant: 'ร้านอาทิตย์', category: 'ร้านอาทิตย์', property: 'hf-hotel', amount: 3480 },
      { merchant: 'ท็อปส์ เดลี่', category: 'บาร์น้ำ', property: 'hf-ville', amount: 720 },
    ],
  },

  // ── approved: the ใครยังรอเงินอยู่ queue, one carrying a failed transfer ──
  {
    id: 'ov_appr_1',
    userId: 'user_mai',
    name: 'เครื่องครัว — กระทะ',
    status: BundleStatus.APPROVED,
    submittedAt: daysAgo(8),
    approvedAt: daysAgo(6),
    receipts: [
      { merchant: 'แม็คโคร กระบี่', category: 'อุปกรณ์โรงแรม', property: 'hf-hotel', amount: 5290 },
    ],
  },
  {
    id: 'ov_appr_failed',
    userId: 'user_maya',
    name: 'ค่าขนส่งของ',
    status: BundleStatus.APPROVED,
    submittedAt: daysAgo(4),
    approvedAt: daysAgo(2),
    paymentError: 'บัญชีปลายทางไม่ถูกต้อง — ตรวจสอบเลขบัญชีแล้วลองใหม่',
    receipts: [{ merchant: 'แกร็บ', category: 'อื่น ๆ', property: 'hf-ville', amount: 1290 }],
  },

  // ── paying: stuck past the watchdog · in flight · needs a human ────────
  {
    id: 'ov_pay_stuck',
    userId: 'user_som',
    name: 'สระว่ายน้ำ — คลอรีน',
    status: BundleStatus.PAYING,
    submittedAt: daysAgo(3),
    approvedAt: daysAgo(1),
    payingSince: minutesAgo(48),
    receipts: [
      { merchant: 'ไทวัสดุ', category: 'อุปกรณ์ช่าง', property: 'hf-ville', amount: 3860 },
    ],
  },
  {
    id: 'ov_pay_fast',
    userId: 'user_niran',
    name: 'กาแฟและชา',
    status: BundleStatus.PAYING,
    submittedAt: daysAgo(2),
    approvedAt: minutesAgo(30),
    payingSince: minutesAgo(3),
    receipts: [
      { merchant: 'ท็อปส์ เดลี่', category: 'บาร์น้ำ', property: 'hf-hotel', amount: 1640 },
    ],
  },
  {
    id: 'ov_pay_manual',
    userId: 'user_mai',
    name: 'ผ้าขนหนูล็อตใหญ่',
    status: BundleStatus.PAYING,
    submittedAt: daysAgo(6),
    approvedAt: daysAgo(4),
    payingSince: daysAgo(1),
    paymentError: 'ไม่ทราบผลการโอน — ต้องตรวจสอบสลิปในแอป K BIZ',
    receipts: [
      { merchant: 'แม็คโคร กระบี่', category: 'อุปกรณ์แม่บ้าน', property: 'hf-hotel', amount: 6480 },
    ],
  },

  // ── rejected: receipts are detached on reject, so this bundle keeps none ─
  {
    id: 'ov_rejected',
    userId: 'user_maya',
    name: 'ค่าอาหารนอกรายการ',
    status: BundleStatus.REJECTED,
    submittedAt: daysAgo(4),
    rejectReason: 'ไม่มีใบเสร็จตัวจริงแนบมา',
    receipts: [],
  },
];

/** Loose receipts — the ใบเสร็จลอย tile, org-wide across three people. */
const ORPHAN_RECEIPTS: readonly OverviewReceiptSeed[] = [
  {
    id: 'ov_loose_1',
    userId: 'user_maya',
    merchant: 'โฮมโปร',
    category: 'อุปกรณ์ช่าง',
    property: 'hf-hotel',
    amount: 890,
    date: isoDay(daysAgo(2)),
  },
  {
    id: 'ov_loose_2',
    userId: 'user_maya',
    merchant: 'แม็คโคร กระบี่',
    category: 'อุปกรณ์แม่บ้าน',
    property: 'hf-hotel',
    amount: 1450,
    date: isoDay(daysAgo(6)),
  },
  {
    id: 'ov_loose_3',
    userId: 'user_som',
    merchant: 'ท็อปส์ เดลี่',
    category: 'บาร์น้ำ',
    property: 'hf-ville',
    amount: 610,
    date: isoDay(daysAgo(9)),
  },
  {
    id: 'ov_loose_4',
    userId: 'user_mai',
    merchant: '',
    category: 'อื่น ๆ',
    property: 'hf-hotel',
    amount: 275,
    date: isoDay(daysAgo(1)),
  },
];

interface AuditSeed {
  readonly id: string;
  readonly type: string;
  readonly bundleId: string | null;
  readonly actorId: string;
  readonly createdAt: Date;
  readonly metadata: Record<string, unknown>;
}

/**
 * The audit trail behind ผลการตัดสิน and ความเคลื่อนไหวล่าสุด.
 *
 * `reject` is the ONLY source of a rejection timestamp — a bundle rejected
 * straight out of PENDING never gets an approvedAt — and `withdraw` carries no
 * bundleId at all, because withdrawing deletes the bundle and leaves only this
 * row behind.
 */
const OVERVIEW_AUDIT: readonly AuditSeed[] = [
  { id: 'ov_ae_sub_1', type: 'submit', bundleId: 'ov_pend_b1', actorId: 'user_maya', createdAt: minutesAgo(200), metadata: {} },
  { id: 'ov_ae_sub_2', type: 'submit', bundleId: 'ov_pend_b2', actorId: 'user_mai', createdAt: daysAgo(3), metadata: {} },
  { id: 'ov_ae_sub_3', type: 'submit', bundleId: 'ov_pend_b4', actorId: 'user_niran', createdAt: daysAgo(11), metadata: {} },
  { id: 'ov_ae_app_1', type: 'approve', bundleId: 'ov_appr_1', actorId: 'user_kpol', createdAt: daysAgo(6), metadata: {} },
  { id: 'ov_ae_app_2', type: 'approve', bundleId: 'ov_paid_today', actorId: 'user_kpol', createdAt: daysAgo(1), metadata: {} },
  { id: 'ov_ae_pay_1', type: 'pay', bundleId: 'ov_paid_dawn', actorId: 'user_kpol', createdAt: earlyMorningPayment(), metadata: { via: 'manual' } },
  { id: 'ov_ae_pay_2', type: 'pay-via-kbiz', bundleId: 'ov_paid_today', actorId: 'user_kpol', createdAt: minutesAgo(95), metadata: { via: 'kbiz-bot' } },
  { id: 'ov_ae_rej_1', type: 'reject', bundleId: 'ov_rejected', actorId: 'user_kpol', createdAt: daysAgo(3), metadata: { reason: 'ไม่มีใบเสร็จตัวจริงแนบมา', fromStatus: 'PENDING' } },
  { id: 'ov_ae_fail_1', type: 'payment-failed', bundleId: 'ov_appr_failed', actorId: 'user_kpol', createdAt: daysAgo(2), metadata: { via: 'kbiz-bot' } },
  { id: 'ov_ae_wd_1', type: 'withdraw', bundleId: null, actorId: 'user_niran', createdAt: daysAgo(2), metadata: { bundleId: 'ov_gone', name: 'สั่งซื้อผิดรายการ', amount: 1250 } },
];

/**
 * The vendor backfill, verbatim from migration 20260814000000.
 *
 * `prisma db push` — how CLAUDE.md says to build a dev DB — creates tables but
 * never functions, so a pushed database has no vendor_normalize() and every
 * vendor-aware query fails. Running the same definition here is what makes
 * `db:up && db push && db:seed` produce a working dev database. CREATE OR
 * REPLACE means the migration and this always converge on one definition, so
 * the backfill and the runtime upsert can never disagree about a match.
 */
const VENDOR_NORMALIZE_DDL = `
  CREATE OR REPLACE FUNCTION vendor_normalize(input text)
  RETURNS text LANGUAGE sql IMMUTABLE STRICT AS $$
    SELECT lower(btrim(regexp_replace(input, '[[:space:]]+', ' ', 'g')))
  $$;
`;

const VENDOR_BACKFILL_INSERT = `
  INSERT INTO "vendors" ("name", "normalizedName")
  SELECT DISTINCT ON (vendor_normalize(r."merchant"))
         btrim(r."merchant"),
         vendor_normalize(r."merchant")
  FROM "receipts" r
  WHERE vendor_normalize(r."merchant") <> ''
  ORDER BY vendor_normalize(r."merchant"), r."createdAt" ASC, r."id" ASC
  ON CONFLICT ("normalizedName") DO NOTHING;
`;

const VENDOR_BACKFILL_LINK = `
  UPDATE "receipts" r
  SET "vendorId" = v."id"
  FROM "vendors" v
  WHERE v."normalizedName" = vendor_normalize(r."merchant")
    AND vendor_normalize(r."merchant") <> ''
    AND r."vendorId" IS NULL;
`;

function buildPrismaClient(databaseUrl: string): PrismaClient {
  const pool = new Pool({ connectionString: databaseUrl });
  const adapter = new PrismaPg(pool);
  return new PrismaClient({ adapter });
}

async function seed(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required');
  }

  const prisma = buildPrismaClient(databaseUrl);

  try {
    await prisma.$transaction(async (tx) => {
      // 1. Users
      for (const user of USERS) {
        await tx.user.upsert({
          where: { id: user.id },
          create: {
            id: user.id,
            name: user.name,
            role: user.role,
            initials: user.initials,
          },
          update: {
            name: user.name,
            role: user.role,
            initials: user.initials,
          },
        });
      }

      // 2. Receipts (bundleId left null; bundle linkage set in step 4)
      for (const receipt of ALL_RECEIPTS) {
        await tx.receipt.upsert({
          where: { id: receipt.id },
          create: {
            id: receipt.id,
            userId: receipt.userId,
            merchant: receipt.merchant,
            category: receipt.category,
            amount: receipt.amount,
            date: receipt.date,
            note: receipt.note,
            color: receipt.color,
            accent: receipt.accent,
            items: receipt.items as unknown as object,
            tax: receipt.tax,
            bundleId: null,
          },
          update: {
            userId: receipt.userId,
            merchant: receipt.merchant,
            category: receipt.category,
            amount: receipt.amount,
            date: receipt.date,
            note: receipt.note,
            color: receipt.color,
            accent: receipt.accent,
            items: receipt.items as unknown as object,
            tax: receipt.tax,
            bundleId: null,
          },
        });
      }

      // 3. Bundles
      for (const bundle of BUNDLES) {
        await tx.bundle.upsert({
          where: { id: bundle.id },
          create: {
            id: bundle.id,
            userId: bundle.userId,
            name: bundle.name,
            status: bundle.status,
            submittedAt: bundle.submittedAt,
            note: bundle.note,
            approvedAt: bundle.approvedAt ?? null,
            approvedById: bundle.approvedById ?? null,
            paidAt: bundle.paidAt ?? null,
            transferRef: bundle.transferRef ?? null,
            transferAmount: bundle.transferAmount ?? null,
          },
          update: {
            userId: bundle.userId,
            name: bundle.name,
            status: bundle.status,
            submittedAt: bundle.submittedAt,
            note: bundle.note,
            approvedAt: bundle.approvedAt ?? null,
            approvedById: bundle.approvedById ?? null,
            paidAt: bundle.paidAt ?? null,
            transferRef: bundle.transferRef ?? null,
            transferAmount: bundle.transferAmount ?? null,
          },
        });
      }

      // 4. Wire receipts into their parent bundle
      for (const bundle of BUNDLES) {
        for (const receiptId of bundle.receiptIds) {
          await tx.receipt.update({
            where: { id: receiptId },
            data: { bundleId: bundle.id },
          });
        }
      }

      // 5. ภาพรวม bundles and their receipts
      for (const bundle of OVERVIEW_BUNDLES) {
        const fields = {
          userId: bundle.userId,
          name: bundle.name,
          status: bundle.status,
          submittedAt: bundle.submittedAt,
          note: '',
          approvedAt: bundle.approvedAt ?? null,
          approvedById: bundle.approvedAt ? 'user_kpol' : null,
          paidAt: bundle.paidAt ?? null,
          payingSince: bundle.payingSince ?? null,
          paymentError: bundle.paymentError ?? null,
          rejectReason: bundle.rejectReason ?? null,
          transferRef: bundle.transferRef ?? null,
        };
        await tx.bundle.upsert({
          where: { id: bundle.id },
          create: { id: bundle.id, ...fields },
          update: fields,
        });

        for (const [index, receipt] of bundle.receipts.entries()) {
          const id = `${bundle.id}_r${index + 1}`;
          const fields = {
            userId: bundle.userId,
            merchant: receipt.merchant,
            category: receipt.category,
            property: receipt.property,
            amount: receipt.amount,
            date: isoDay(bundle.paidAt ?? bundle.submittedAt),
            note: null,
            items: [] as unknown as object,
            tax: '0',
            bundleId: bundle.id,
          };
          await tx.receipt.upsert({
            where: { id },
            create: { id, ...fields },
            update: fields,
          });
        }
      }

      // 6. Loose receipts — deliberately left with no bundle
      for (const receipt of ORPHAN_RECEIPTS) {
        const fields = {
          userId: receipt.userId,
          merchant: receipt.merchant,
          category: receipt.category,
          property: receipt.property,
          amount: receipt.amount,
          date: receipt.date,
          note: null,
          items: [] as unknown as object,
          tax: '0',
          bundleId: null,
        };
        await tx.receipt.upsert({
          where: { id: receipt.id },
          create: { id: receipt.id, ...fields },
          update: fields,
        });
      }

      // 7. Audit trail
      for (const event of OVERVIEW_AUDIT) {
        const fields = {
          type: event.type,
          bundleId: event.bundleId,
          actorId: event.actorId,
          createdAt: event.createdAt,
          metadata: event.metadata as object,
        };
        await tx.auditEvent.upsert({
          where: { id: event.id },
          create: { id: event.id, ...fields },
          update: fields,
        });
      }

      // 8. Resolve every merchant to a Vendor, exactly as the migration does
      await tx.$executeRawUnsafe(VENDOR_NORMALIZE_DDL);
      await tx.$executeRawUnsafe(VENDOR_BACKFILL_INSERT);
      await tx.$executeRawUnsafe(VENDOR_BACKFILL_LINK);
    });

    const receiptCount =
      ALL_RECEIPTS.length +
      ORPHAN_RECEIPTS.length +
      OVERVIEW_BUNDLES.reduce((sum, bundle) => sum + bundle.receipts.length, 0);
    console.log(
      `Seeded ${USERS.length} users, ${receiptCount} receipts, ` +
        `${BUNDLES.length + OVERVIEW_BUNDLES.length} bundles, ` +
        `${OVERVIEW_AUDIT.length} audit events.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

seed().catch((error: unknown) => {
  console.error('Seed failed:', error);
  process.exit(1);
});
