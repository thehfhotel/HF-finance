import { useEffect, useState } from 'react';
import { RECEIPT_CATEGORIES } from '@reimbursement/shared';
import { api } from './api';

/**
 * The receipt form's live category list — admin-managed on the ตั้งค่า screen.
 *
 * Fetched once per session (module cache; every form mount after the first is
 * free) with the built-in list as the fallback while loading or offline, so
 * the form is never empty. An admin edit shows up on the next full page load,
 * which is how often the categories realistically change.
 */
let cached: string[] | null = null;
let inflight: Promise<string[]> | null = null;

function fetchOnce(): Promise<string[]> {
  if (cached) return Promise.resolve(cached);
  inflight ??= api.receipts
    .categories()
    .then((r) => {
      cached = r.categories.length > 0 ? r.categories : [...RECEIPT_CATEGORIES];
      return cached;
    })
    .catch(() => {
      inflight = null; // retry on the next mount rather than caching a failure
      return [...RECEIPT_CATEGORIES];
    });
  return inflight;
}

export function useReceiptCategories(): string[] {
  const [categories, setCategories] = useState<string[]>(cached ?? [...RECEIPT_CATEGORIES]);
  useEffect(() => {
    let cancelled = false;
    void fetchOnce().then((list) => {
      if (!cancelled) setCategories(list);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return categories;
}
