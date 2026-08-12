import type { ReactNode } from 'react';

interface IOSDeviceProps {
  children: ReactNode;
  width?: number;
  height?: number;
  dark?: boolean;
}

/**
 * Minimal phone-shaped frame for the mobile preview shell.
 * Used in dev to visualize how the app will look on a phone;
 * in production the app simply renders full-bleed at the user's viewport.
 */
export function IOSDevice({ children, width = 402, height = 874, dark = false }: IOSDeviceProps) {
  return (
    <div
      style={{
        position: 'relative',
        width,
        height,
        borderRadius: 56,
        background: dark ? '#0a0a0a' : '#1a1a1a',
        padding: 12,
        boxShadow: '0 30px 80px rgba(0,0,0,0.5), 0 8px 24px rgba(0,0,0,0.3)',
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          position: 'relative',
          width: '100%',
          height: '100%',
          borderRadius: 44,
          overflow: 'hidden',
          background: '#000',
        }}
      >
        {/* Dynamic island */}
        <div
          style={{
            position: 'absolute',
            top: 12,
            left: '50%',
            transform: 'translateX(-50%)',
            width: 120,
            height: 32,
            borderRadius: 999,
            background: '#000',
            zIndex: 30,
          }}
        />
        {children}
      </div>
    </div>
  );
}
