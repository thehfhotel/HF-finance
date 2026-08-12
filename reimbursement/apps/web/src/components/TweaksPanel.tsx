import { useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { ACCENT_OPTIONS } from '../lib/theme';
import type { Platform, Role, Tweaks } from '../lib/types';

interface TweaksPanelProps {
  tweaks: Tweaks;
  onChange: <K extends keyof Tweaks>(key: K, value: Tweaks[K]) => void;
  onJump: (target: string) => void;
}

const PANEL_BG = '#15151A';
const TEXT = '#F4F1EA';
const TEXT_SOFT = 'rgba(244,241,234,0.6)';
const HAIRLINE = 'rgba(244,241,234,0.12)';

const labelStyle: CSSProperties = {
  fontFamily: 'Arial, sans-serif',
  fontSize: 10,
  fontWeight: 600,
  color: TEXT_SOFT,
  letterSpacing: 1.4,
  textTransform: 'uppercase',
};

export function TweaksPanel({ tweaks, onChange, onJump }: TweaksPanelProps) {
  const [open, setOpen] = useState(true);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        style={{
          position: 'fixed',
          right: 16,
          top: 16,
          zIndex: 200,
          width: 36,
          height: 36,
          borderRadius: 18,
          background: PANEL_BG,
          color: TEXT,
          border: `0.5px solid ${HAIRLINE}`,
          cursor: 'pointer',
          fontFamily: 'Arial, sans-serif',
          fontSize: 12,
        }}
      >
        ⋯
      </button>
    );
  }

  return (
    <div
      style={{
        position: 'fixed',
        right: 16,
        top: 16,
        bottom: 16,
        width: 240,
        background: PANEL_BG,
        color: TEXT,
        borderRadius: 16,
        padding: 16,
        zIndex: 200,
        overflowY: 'auto',
        fontFamily: 'Arial, sans-serif',
        boxShadow: '0 12px 40px rgba(0,0,0,0.4)',
        border: `0.5px solid ${HAIRLINE}`,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>Dev tweaks</span>
        <button
          onClick={() => setOpen(false)}
          style={{
            background: 'transparent',
            border: 'none',
            color: TEXT_SOFT,
            cursor: 'pointer',
            fontSize: 18,
            lineHeight: 1,
          }}
        >
          ×
        </button>
      </div>

      <Section label="Role">
        <Radio
          value={tweaks.role}
          options={[
            { label: 'Employee', value: 'employee' },
            { label: 'Approver', value: 'approver' },
          ]}
          onChange={(v) => onChange('role', v as Role)}
        />
        <Radio
          value={tweaks.platform}
          options={[
            { label: 'Mobile', value: 'mobile' },
            { label: 'Desktop', value: 'desktop' },
          ]}
          onChange={(v) => onChange('platform', v as Platform)}
        />
      </Section>

      <Section label="Theme">
        <Toggle label="Dark" value={tweaks.dark} onChange={(v) => onChange('dark', v)} />
        <div style={{ ...labelStyle, marginTop: 8, marginBottom: 6 }}>Accent</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {ACCENT_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => onChange('accent', opt.value)}
              style={{
                width: 24,
                height: 24,
                borderRadius: 12,
                background: opt.value,
                border: tweaks.accent === opt.value ? `2px solid ${TEXT}` : `1px solid ${HAIRLINE}`,
                cursor: 'pointer',
                padding: 0,
              }}
              title={opt.label}
            />
          ))}
        </div>
      </Section>

      <Section label="Data source">
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 10px',
            background: 'rgba(0,0,0,0.3)',
            borderRadius: 8,
            border: `0.5px solid ${HAIRLINE}`,
            fontFamily: 'Arial, sans-serif',
            fontSize: 11,
            color: TEXT,
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: 3,
              background: '#3B7A4B',
              flexShrink: 0,
            }}
          />
          API · {'/api'}
        </div>
      </Section>

      <Section label="Jump to screen">
        {tweaks.role === 'employee' ? (
          <>
            <JumpButton onClick={() => onJump('home')}>Home</JumpButton>
            <JumpButton onClick={() => onJump('upload')}>Upload receipt</JumpButton>
            <JumpButton onClick={() => onJump('bundle-new')}>Bundle &amp; submit</JumpButton>
            <JumpButton onClick={() => onJump('bundle:b3')}>Open paid bundle</JumpButton>
          </>
        ) : (
          <>
            <JumpButton onClick={() => onJump('approver-home')}>Inbox</JumpButton>
            <JumpButton onClick={() => onJump('approver-review:b1')}>Review pending</JumpButton>
            <JumpButton onClick={() => onJump('approver-review:b2')}>Mark paid</JumpButton>
            <JumpButton onClick={() => onJump('admin-employees')}>Manage employees</JumpButton>
          </>
        )}
      </Section>

      <Section label="Session">
        <button
          onClick={() => onJump('logout')}
          style={{
            padding: '7px 10px',
            background: 'rgba(180,58,58,0.15)',
            color: '#F4F1EA',
            border: `0.5px solid rgba(180,58,58,0.4)`,
            borderRadius: 8,
            fontFamily: 'Arial, sans-serif',
            fontSize: 12,
            cursor: 'pointer',
            textAlign: 'left',
          }}
        >
          Logout
        </button>
      </Section>
    </div>
  );
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ ...labelStyle, marginBottom: 8 }}>{label}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>{children}</div>
    </div>
  );
}

interface RadioProps<T extends string> {
  value: T;
  options: ReadonlyArray<{ label: string; value: T }>;
  onChange: (v: T) => void;
}

function Radio<T extends string>({ value, options, onChange }: RadioProps<T>) {
  return (
    <div
      style={{
        display: 'flex',
        gap: 0,
        background: 'rgba(0,0,0,0.3)',
        borderRadius: 8,
        padding: 2,
        border: `0.5px solid ${HAIRLINE}`,
      }}
    >
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          style={{
            flex: 1,
            padding: '6px 8px',
            background: value === opt.value ? 'rgba(244,241,234,0.12)' : 'transparent',
            color: value === opt.value ? TEXT : TEXT_SOFT,
            border: 'none',
            borderRadius: 6,
            fontFamily: 'Arial, sans-serif',
            fontSize: 11,
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!value)}
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        background: 'transparent',
        border: 'none',
        padding: 0,
        cursor: 'pointer',
        color: TEXT,
      }}
    >
      <span style={{ fontFamily: 'Arial, sans-serif', fontSize: 12 }}>{label}</span>
      <span
        style={{
          width: 30,
          height: 18,
          borderRadius: 9,
          background: value ? '#3B7A4B' : 'rgba(244,241,234,0.18)',
          position: 'relative',
          transition: 'background 0.15s',
        }}
      >
        <span
          style={{
            position: 'absolute',
            top: 2,
            left: value ? 14 : 2,
            width: 14,
            height: 14,
            borderRadius: 7,
            background: '#fff',
            transition: 'left 0.15s',
          }}
        />
      </span>
    </button>
  );
}

function JumpButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '7px 10px',
        background: 'rgba(244,241,234,0.06)',
        color: TEXT,
        border: `0.5px solid ${HAIRLINE}`,
        borderRadius: 8,
        fontFamily: 'Arial, sans-serif',
        fontSize: 12,
        cursor: 'pointer',
        textAlign: 'left',
      }}
    >
      {children}
    </button>
  );
}
