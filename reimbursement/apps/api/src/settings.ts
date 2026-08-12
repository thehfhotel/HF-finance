import {
  DEFAULT_KBIZ_CATEGORY_MAPPING,
  KBIZ_CATEGORIES,
  SETTING_KBIZ_CATEGORY_MAPPING,
  SETTING_KBIZ_PAYEES,
  type KbizCategoryId,
  type KbizCategoryMapping,
  type KbizPayeeHandles,
  RECEIPT_CATEGORIES,
  SETTING_RECEIPT_CATEGORIES,
} from '@reimbursement/shared';
import { prisma } from './db';
import { Prisma } from './generated/prisma';

/**
 * Runtime settings, stored one JSON blob per key in `app_settings`.
 *
 * These are the values an admin changes without a deploy — today the KBIZ
 * category mapping and the payee handles. The keys themselves are a closed set
 * owned by code (`SETTING_*` in @reimbursement/shared); this module is only the
 * read/write plumbing plus the fallbacks that make a never-configured install
 * behave exactly like a freshly seeded one.
 *
 * Every reader falls back rather than throwing: a missing row, a hand-edited
 * blob of the wrong shape, or a value written by an older version must never
 * take a payment screen down.
 */

const KBIZ_CATEGORY_IDS = new Set<string>(KBIZ_CATEGORIES.map((category) => category.id));

/** True for one of KBIZ's own picker anchor ids (`'1'`…`'30'`, sparse). */
export function isKbizCategoryId(value: unknown): value is KbizCategoryId {
  return typeof value === 'string' && KBIZ_CATEGORY_IDS.has(value);
}

/** Read a JSON setting, or `fallback` when it is unset. */
export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const row = await prisma.appSetting.findUnique({ where: { key } });
  if (!row || row.value === null) return fallback;
  return row.value as T;
}

/** Write a JSON setting, creating the row on first use. */
export async function putSetting(key: string, value: unknown): Promise<void> {
  const json = value as Prisma.InputJsonValue;
  await prisma.appSetting.upsert({
    where: { key },
    create: { key, value: json },
    update: { value: json },
  });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The admin-editable receipt-category → KBIZ-category mapping.
 *
 * Unset, or stored in a shape this version does not recognise, falls back to
 * `DEFAULT_KBIZ_CATEGORY_MAPPING` — the seed mapping every install starts with.
 * Individual entries pointing at an id KBIZ no longer offers are dropped rather
 * than kept, so `resolveKbizCategoryId` can only ever return a real picker id.
 */
export async function getKbizCategoryMapping(): Promise<KbizCategoryMapping> {
  const stored = await getSetting<unknown>(SETTING_KBIZ_CATEGORY_MAPPING, null);
  if (!isPlainObject(stored) || !isPlainObject(stored.categories)) {
    return DEFAULT_KBIZ_CATEGORY_MAPPING;
  }

  const categories: Record<string, KbizCategoryId> = {};
  for (const [receiptCategory, kbizId] of Object.entries(stored.categories)) {
    if (isKbizCategoryId(kbizId)) categories[receiptCategory] = kbizId;
  }

  return {
    categories,
    defaultCategoryId: isKbizCategoryId(stored.defaultCategoryId)
      ? stored.defaultCategoryId
      : DEFAULT_KBIZ_CATEGORY_MAPPING.defaultCategoryId,
  };
}

/**
 * `User.id` → kbiz-bot payee handle. Unset falls back to `{}`, which means
 * nobody is payable by the bot — the fail-closed default, since the bot may
 * only pay accounts already saved and vetted inside KBIZ.
 */
export async function getKbizPayees(): Promise<KbizPayeeHandles> {
  const stored = await getSetting<unknown>(SETTING_KBIZ_PAYEES, null);
  if (!isPlainObject(stored)) return {};

  const payees: KbizPayeeHandles = {};
  for (const [userId, handle] of Object.entries(stored)) {
    if (typeof handle === 'string' && handle.trim().length > 0) {
      payees[userId] = handle.trim();
    }
  }
  return payees;
}


/**
 * The receipt form's category list — admin-managed, seeded from
 * RECEIPT_CATEGORIES. Fail-safe like every other settings reader: a missing or
 * malformed row falls back to the built-in list rather than an empty form.
 */
export async function getReceiptCategories(): Promise<string[]> {
  const raw = await getSetting<unknown>(SETTING_RECEIPT_CATEGORIES, null);
  if (!Array.isArray(raw)) return [...RECEIPT_CATEGORIES];
  const cleaned = raw
    .filter((c): c is string => typeof c === 'string')
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
  return cleaned.length > 0 ? [...new Set(cleaned)] : [...RECEIPT_CATEGORIES];
}
