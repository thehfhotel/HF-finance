import { useCallback, useEffect, useRef, useState } from 'react';
import type { InboxItem, Theme } from '../../lib/types';
import type { Nav } from '../../lib/router';
import { api } from '../../lib/api';
import { photoSrc } from '../../components/Receipts';
import { FONT_UI } from '../../lib/theme';
import { AppBar } from '../../components/AppBar';
import { Card, IconBtn } from '../../components/primitives';
import { EmptyState } from '../../components/EmptyState';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Icon } from '../../components/icons';
import { ConnectPhone } from './ConnectPhone';

interface ShareInboxProps {
  theme: Theme;
  nav: Nav;
  /** Reason code from a failed Android share (`?shareError=`), if any. */
  shareError?: string | null;
  /**
   * Report the queue length up so the nav badge matches what is on screen.
   * This screen is the only place the list is actually loaded, so it is the
   * only place that knows.
   */
  onCountChange?: (count: number) => void;
}

/**
 * กล่องขาเข้า — files shared in from a phone that are not receipts yet.
 *
 * This screen exists so that a shared photo never has to be a half-filled
 * Receipt. Sharing is a two-second act at the counter; typing the amount and
 * category is a sit-down act later. The queue is what separates them.
 *
 * Every item drains into the ordinary upload form — there is deliberately no
 * second "quick receipt" form to keep in sync with the real one.
 */
export function ShareInbox({
  theme,
  nav,
  shareError = null,
  onCountChange,
}: ShareInboxProps) {
  const [items, setItems] = useState<InboxItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [discarding, setDiscarding] = useState<InboxItem | null>(null);
  const [connecting, setConnecting] = useState(false);

  // Held in a ref so `load` does not change identity when the callback prop
  // does — otherwise the mount effect below re-runs on every parent render and
  // the screen refetches in a loop.
  const onCountChangeRef = useRef(onCountChange);
  onCountChangeRef.current = onCountChange;

  const load = useCallback(async () => {
    try {
      const loaded = await api.inbox.list();
      setItems(loaded);
      setError(null);
      onCountChangeRef.current?.(loaded.length);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'โหลดไม่สำเร็จ');
      setItems([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const confirmDiscard = async () => {
    if (!discarding) return;
    const target = discarding;
    setDiscarding(null);
    // Optimistic: the row is gone from the server's perspective the moment the
    // call lands, and a list that lags behind the tap feels broken.
    //
    // Computed outside the updater on purpose — a state updater must be pure,
    // and React invokes it twice under StrictMode, so notifying the parent from
    // inside would double-fire.
    const next = (items ?? []).filter((item) => item.id !== target.id);
    setItems(next);
    onCountChangeRef.current?.(next.length);
    try {
      await api.inbox.discard(target.id);
    } catch {
      void load();
    }
  };

  return (
    <div style={{ minHeight: '100%', background: theme.paper, paddingBottom: 96 }}>
      <AppBar
        theme={theme}
        leading={
          <IconBtn theme={theme} onClick={() => nav({ name: 'home' })}>
            {Icon.back(theme.ink)}
          </IconBtn>
        }
        title="กล่องขาเข้า"
        trailing={
          <IconBtn theme={theme} onClick={() => setConnecting(true)}>
            {Icon.phone(theme.ink)}
          </IconBtn>
        }
      />

      <div style={{ padding: '12px 16px 0' }}>
        {shareError !== null && <ShareErrorNote theme={theme} reason={shareError} />}

        {error !== null && (
          <Card theme={theme} padding={14} style={{ marginBottom: 12 }}>
            <span style={{ fontFamily: FONT_UI, color: theme.danger }}>{error}</span>
          </Card>
        )}

        {items !== null && items.length > 0 && (
          <p
            style={{
              fontFamily: FONT_UI,
              fontSize: 13,
              color: theme.inkSofter,
              margin: '0 0 14px',
              lineHeight: 1.5,
            }}
          >
            ไฟล์ที่ส่งเข้ามาจากมือถือ — แตะเพื่อกรอกจำนวนเงินและหมวดหมู่ให้เป็นใบเสร็จ
          </p>
        )}

        {items === null && <SkeletonGrid theme={theme} />}

        {items !== null && items.length === 0 && error === null && (
          <div style={{ paddingTop: 40 }}>
            <EmptyState
              theme={theme}
              icon={Icon.inbox}
              title="ยังไม่มีไฟล์ที่ส่งเข้ามา"
              subtext="แชร์รูปหรือ PDF จากมือถือมาที่แอปนี้ แล้วไฟล์จะมารออยู่ตรงนี้"
              // The empty state IS the discovery path: somebody looking at an
              // empty queue is exactly the person who has not set their phone
              // up yet, so the setup action belongs here and not only behind
              // the app-bar icon.
              action={{ label: 'เชื่อมต่อมือถือ', onClick: () => setConnecting(true) }}
            />
          </div>
        )}

        {items !== null && items.length > 0 && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(148px, 1fr))',
              gap: 12,
            }}
          >
            {items.map((item) => (
              <InboxTile
                key={item.id}
                theme={theme}
                item={item}
                onOpen={() => nav({ name: 'upload', inboxId: item.id })}
                onDiscard={() => setDiscarding(item)}
              />
            ))}
          </div>
        )}
      </div>

      {connecting && <ConnectPhone theme={theme} onClose={() => setConnecting(false)} />}

      {discarding !== null && (
        <ConfirmDialog
          theme={theme}
          title="ลบไฟล์นี้?"
          message="ไฟล์จะหายไปจากกล่องขาเข้า และจะไม่ถูกสร้างเป็นใบเสร็จ"
          confirmLabel="ลบ"
          cancelLabel="ยกเลิก"
          danger
          onConfirm={() => void confirmDiscard()}
          onCancel={() => setDiscarding(null)}
        />
      )}
    </div>
  );
}

/**
 * One shared file.
 *
 * `previewable` is the server's verdict on whether the stored file is something
 * an <img> can render — a PDF on a host without Ghostscript is not, and putting
 * it in an <img> anyway would show a broken-image glyph where the employee
 * expects their receipt.
 */
function InboxTile({
  theme,
  item,
  onOpen,
  onDiscard,
}: {
  theme: Theme;
  item: InboxItem;
  onOpen: () => void;
  onDiscard: () => void;
}) {
  return (
    <div style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={onOpen}
        style={{
          display: 'block',
          width: '100%',
          padding: 0,
          border: `1px solid ${theme.hairline}`,
          borderRadius: 14,
          overflow: 'hidden',
          background: theme.surface,
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <div
          style={{
            height: 132,
            background: theme.surface2,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {item.previewable ? (
            <img
              src={photoSrc(item.photoPath, 320)}
              alt={item.filename ?? 'ไฟล์ที่แชร์เข้ามา'}
              loading="lazy"
              decoding="async"
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            />
          ) : (
            <div style={{ textAlign: 'center', color: theme.inkSofter }}>
              {Icon.document(theme.inkSofter)}
              <div style={{ fontFamily: FONT_UI, fontSize: 11, marginTop: 4 }}>
                {item.mimeType === 'application/pdf' ? 'PDF' : 'ไฟล์'}
              </div>
            </div>
          )}
          {item.pageCount > 1 && (
            <span
              style={{
                position: 'absolute',
                bottom: 6,
                left: 6,
                fontFamily: FONT_UI,
                fontSize: 10,
                fontWeight: 700,
                color: '#fff',
                background: 'rgba(0,0,0,0.62)',
                padding: '3px 7px',
                borderRadius: 100,
              }}
            >
              {item.pageCount} หน้า
            </span>
          )}
        </div>

        <div style={{ padding: '9px 11px 11px' }}>
          <div
            style={{
              fontFamily: FONT_UI,
              fontSize: 12,
              color: theme.ink,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {item.filename ?? 'ไฟล์ที่แชร์เข้ามา'}
          </div>
          <div style={{ fontFamily: FONT_UI, fontSize: 11, color: theme.inkSofter, marginTop: 2 }}>
            {relativeThaiTime(item.createdAt)}
          </div>
        </div>
      </button>

      <button
        type="button"
        onClick={onDiscard}
        aria-label="ลบไฟล์นี้"
        style={{
          position: 'absolute',
          top: 6,
          right: 6,
          width: 30,
          height: 30,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 15,
          border: 'none',
          background: 'rgba(0,0,0,0.45)',
          color: '#fff',
          cursor: 'pointer',
        }}
      >
        {Icon.close('#fff')}
      </button>
    </div>
  );
}

/**
 * The Android share target reports failure by bouncing back with a reason code
 * rather than rendering an error document — the person tapped "share" and is
 * watching a page load, so a JSON body would be the wrong thing to show them.
 * This turns the code back into a sentence.
 */
function ShareErrorNote({ theme, reason }: { theme: Theme; reason: string }) {
  const MESSAGES: Record<string, string> = {
    auth: 'ยังไม่ได้เข้าสู่ระบบ — เปิดแอปแล้วลองแชร์อีกครั้ง',
    kiosk: 'เครื่องนี้เป็นเครื่องส่วนกลาง ไม่ใช่บัญชีพนักงาน — แตะบัตรก่อนแล้วลองใหม่',
    nofile: 'ไม่พบไฟล์ที่แชร์เข้ามา',
    toolarge: 'ไฟล์ใหญ่เกินไป (สูงสุด 20 MB)',
    type: 'ไฟล์ชนิดนี้ยังไม่รองรับ — ใช้รูปภาพหรือ PDF',
    failed: 'บันทึกไฟล์ไม่สำเร็จ ลองอีกครั้ง',
  };

  return (
    <Card theme={theme} padding={14} style={{ marginBottom: 12, borderColor: theme.danger }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        {Icon.xCircle(theme.danger)}
        <span style={{ fontFamily: FONT_UI, fontSize: 13, color: theme.ink, lineHeight: 1.5 }}>
          {MESSAGES[reason] ?? 'แชร์ไฟล์ไม่สำเร็จ'}
        </span>
      </div>
    </Card>
  );
}

function SkeletonGrid({ theme }: { theme: Theme }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(148px, 1fr))',
        gap: 12,
      }}
    >
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          style={{
            height: 180,
            borderRadius: 14,
            background: theme.surface2,
            border: `1px solid ${theme.hairline}`,
          }}
        />
      ))}
    </div>
  );
}

/**
 * "2 นาทีที่แล้ว" / "เมื่อวาน".
 *
 * Inbox items are minutes-to-days old and get drained fast, so a relative
 * stamp is the readable one here — an absolute date would make every tile look
 * the same on the day the employee actually shares things.
 */
function relativeThaiTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const minutes = Math.floor((Date.now() - then) / 60000);

  if (minutes < 1) return 'เมื่อสักครู่';
  if (minutes < 60) return `${minutes} นาทีที่แล้ว`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ชั่วโมงที่แล้ว`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'เมื่อวาน';
  if (days < 7) return `${days} วันที่แล้ว`;
  return new Date(iso).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' });
}
