import { useState } from 'react';
import type { OverviewWindowKey } from '../../../lib/api';

/**
 * Which period the approver lands on, remembered per browser.
 *
 * Default สัปดาห์นี้: วันนี้ is empty before the morning's first transfer,
 * เดือนนี้ is the accountant's rhythm, and the week is the owner's. A stored
 * value that is not one of the three keys is treated as absent rather than
 * trusted, and storage that throws (private mode, a locked-down webview) falls
 * back to the default instead of taking the page down with it.
 */

const STORAGE_KEY = 'hf-overview-window';
const DEFAULT_WINDOW: OverviewWindowKey = 'week';
const VALID: readonly OverviewWindowKey[] = ['day', 'week', 'month'];

export function loadWindowPreference(): OverviewWindowKey {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return VALID.includes(stored as OverviewWindowKey) ? (stored as OverviewWindowKey) : DEFAULT_WINDOW;
  } catch {
    return DEFAULT_WINDOW;
  }
}

export function saveWindowPreference(value: OverviewWindowKey): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, value);
  } catch {
    // Storage is unavailable; the choice still holds for this session.
  }
}

export function useWindowPreference(): [OverviewWindowKey, (value: OverviewWindowKey) => void] {
  const [value, setValue] = useState<OverviewWindowKey>(loadWindowPreference);
  return [
    value,
    (next: OverviewWindowKey) => {
      setValue(next);
      saveWindowPreference(next);
    },
  ];
}
