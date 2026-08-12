import { useEffect, useState } from 'react';

const DESKTOP_QUERY = '(min-width: 768px)';

/**
 * Returns the layout platform implied by the current viewport width and keeps
 * it in sync as the window resizes: ≥768px → 'desktop', otherwise 'mobile'.
 * Used in production to pick between the desktop and mobile layouts (the dev
 * tweaks panel can still override this explicitly).
 */
export function useViewportPlatform(): 'mobile' | 'desktop' {
  const [isDesktop, setIsDesktop] = useState<boolean>(() =>
    typeof window === 'undefined' ? true : window.matchMedia(DESKTOP_QUERY).matches,
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia(DESKTOP_QUERY);
    const onChange = (event: MediaQueryListEvent) => setIsDesktop(event.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return isDesktop ? 'desktop' : 'mobile';
}
