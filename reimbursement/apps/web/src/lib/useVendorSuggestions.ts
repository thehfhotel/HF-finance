import { useEffect, useState } from 'react';
import type { VendorSuggestion } from './api';
import { api } from './api';

/**
 * Merchant suggestions for the receipt form.
 *
 * The field is free text and stays free text: a suggestion only fills the
 * canonical spelling in, and the server resolves the vendor from whatever
 * string is saved. So a slow or failed request is silent — never a blocked
 * save, never an error under the field.
 *
 * Results are cached per normalized query for the session because the same few
 * shops are typed dozens of times a week, and the endpoint's answer for
 * "แม็ค" does not change between two receipts.
 */

const DEBOUNCE_MS = 250;
/** Below this, the query matches most of the vendor book and helps nobody. */
const MIN_QUERY_LENGTH = 2;
const LIMIT = 8;

const cache = new Map<string, VendorSuggestion[]>();

/** Cache key only — the match itself is `vendor_normalize()` in Postgres and
 *  is never mirrored here. */
const cacheKey = (q: string): string => q.trim().replace(/\s+/g, ' ').toLowerCase();

export function useVendorSuggestions(query: string, enabled: boolean): VendorSuggestion[] {
  const [suggestions, setSuggestions] = useState<VendorSuggestion[]>([]);

  useEffect(() => {
    const key = cacheKey(query);
    if (!enabled || key.length < MIN_QUERY_LENGTH) {
      setSuggestions([]);
      return;
    }

    const cached = cache.get(key);
    if (cached) {
      setSuggestions(cached);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      api.vendors
        .search(query.trim(), LIMIT)
        .then((res) => {
          cache.set(key, res.vendors);
          if (!cancelled) setSuggestions(res.vendors);
        })
        .catch(() => {
          // Suggestions are an accelerator, not a dependency: on failure the
          // field keeps working as the free-text input it has always been.
          if (!cancelled) setSuggestions([]);
        });
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, enabled]);

  return suggestions;
}
