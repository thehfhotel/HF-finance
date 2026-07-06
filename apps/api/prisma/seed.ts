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
  { id: 'user_admin', name: 'แอดมิน สำนักงาน', role: Role.ADMIN, initials: 'อด' },
];

// A few company-expense ledger entries so the admin dashboard/report have
// data in dev. Month is fixed (like the receipt dates above).
const EXPENSE_MONTH = '2026-07';

interface ExpenseSeed {
  readonly id: string;
  readonly plLine: string;
  readonly vendor: string;
  readonly amount: number;
  readonly paymentMethod: 'cash' | 'transfer';
  readonly paid: boolean;
  readonly billingPeriod?: string;
  readonly note?: string;
}

const EXPENSES: readonly ExpenseSeed[] = [
  { id: 'exp1', plLine: 'elec_saichon', vendor: 'การไฟฟ้าส่วนภูมิภาค', amount: 58212.4, paymentMethod: 'transfer', paid: true, billingPeriod: 'มิ.ย. 69' },
  { id: 'exp2', plLine: 'water_saichon', vendor: 'การประปาส่วนภูมิภาค', amount: 6120.55, paymentMethod: 'transfer', paid: true, billingPeriod: 'มิ.ย. 69' },
  { id: 'exp3', plLine: 'laundry', vendor: 'โรงซักผ้าสายชล', amount: 6800, paymentMethod: 'cash', paid: true },
  { id: 'exp4', plLine: 'elec_ville', vendor: 'การไฟฟ้าส่วนภูมิภาค', amount: 41230.05, paymentMethod: 'transfer', paid: false, billingPeriod: 'มิ.ย. 69', note: 'รอครบกำหนด 15 ก.ค.' },
];

// Six receipts owned by user_niran, mirroring SAMPLE_RECEIPTS.
const NIRAN_RECEIPTS: readonly ReceiptSeed[] = [
  {
    id: 'r1',
    userId: 'user_niran',
    merchant: 'วิลล่า มาร์เก็ต',
    category: 'อาหาร & เครื่องดื่ม',
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
    category: 'ซ่อมบำรุง',
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
    category: 'สาธารณูปโภค',
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
    category: 'แม่บ้าน',
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
    category: 'อาหาร & เครื่องดื่ม',
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
    category: 'ขนส่ง',
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

      // 5. Company-expense ledger entries (admin-entered)
      for (const expense of EXPENSES) {
        const data = {
          enteredById: 'user_admin',
          plLine: expense.plLine,
          expenseMonth: EXPENSE_MONTH,
          vendor: expense.vendor,
          amount: expense.amount,
          paymentMethod: expense.paymentMethod,
          paid: expense.paid,
          billingPeriod: expense.billingPeriod ?? null,
          note: expense.note ?? null,
        };
        await tx.expense.upsert({
          where: { id: expense.id },
          create: { id: expense.id, ...data },
          update: data,
        });
      }

      // 6. Revenue figures for the seeded ledger month
      await tx.revenueEntry.upsert({
        where: { month: EXPENSE_MONTH },
        create: { month: EXPENSE_MONTH, rooms: 512340.5, waterBar: 3100, other: 1250 },
        update: { rooms: 512340.5, waterBar: 3100, other: 1250 },
      });
    });

    console.log(
      `Seeded ${USERS.length} users, ${ALL_RECEIPTS.length} receipts, ${BUNDLES.length} bundles, ${EXPENSES.length} expenses.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

seed().catch((error: unknown) => {
  console.error('Seed failed:', error);
  process.exit(1);
});
