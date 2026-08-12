import { FONT_UI } from '../lib/theme';
import type { Theme } from '../lib/types';

interface BaseProps {
  theme: Theme;
  label: string;
  value: string;
  placeholder?: string;
  readOnly?: boolean;
  /** Required-field violation: label + border go danger-red. */
  error?: boolean;
}

interface InputProps extends BaseProps {
  onChange?: (v: string) => void;
  multiline?: false;
  select?: false;
}

interface MultilineProps extends BaseProps {
  onChange?: (v: string) => void;
  multiline: true;
  select?: false;
}

interface SelectProps extends BaseProps {
  onChange: (v: string) => void;
  select: true;
  options: readonly string[];
  /** Optional display labels for each option value, e.g. { 'hf-hotel': 'HF Hotel' }. */
  optionLabels?: Readonly<Record<string, string>>;
  multiline?: false;
}

type FormRowProps = InputProps | MultilineProps | SelectProps;

export function FormRow(props: FormRowProps) {
  const { theme, label, value, placeholder, readOnly, error } = props;
  return (
    <div style={{ marginBottom: 18 }}>
      <div
        style={{
          fontFamily: FONT_UI,
          fontSize: 11,
          color: error ? theme.danger : theme.inkSoft,
          letterSpacing: 1.4,
          textTransform: 'uppercase',
          marginBottom: 8,
        }}
      >
        {label}
      </div>
      {props.select ? (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {props.options.map((opt) => (
            <button
              key={opt}
              onClick={() => props.onChange(opt)}
              style={{
                padding: '8px 14px',
                borderRadius: 100,
                background: value === opt ? theme.ink : 'transparent',
                color: value === opt ? theme.paper : theme.ink,
                border: `0.5px solid ${value === opt ? theme.ink : theme.hairlineStrong}`,
                fontFamily: FONT_UI,
                fontSize: 13,
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              {props.optionLabels?.[opt] ?? opt}
            </button>
          ))}
        </div>
      ) : props.multiline ? (
        <textarea
          value={value}
          onChange={(e) => props.onChange && props.onChange(e.target.value)}
          placeholder={placeholder}
          readOnly={readOnly}
          style={{
            width: '100%',
            padding: '12px 14px',
            borderRadius: 12,
            background: theme.surface,
            border: error ? `1.5px solid ${theme.danger}` : `0.5px solid ${theme.hairlineStrong}`,
            fontFamily: FONT_UI,
            fontSize: 14,
            color: theme.ink,
            outline: 'none',
            minHeight: 60,
            resize: 'none',
            boxSizing: 'border-box',
          }}
        />
      ) : (
        <input
          value={value}
          onChange={(e) => props.onChange && props.onChange(e.target.value)}
          placeholder={placeholder}
          readOnly={readOnly}
          style={{
            width: '100%',
            padding: '12px 14px',
            borderRadius: 12,
            background: theme.surface,
            border: error ? `1.5px solid ${theme.danger}` : `0.5px solid ${theme.hairlineStrong}`,
            fontFamily: FONT_UI,
            fontSize: 15,
            color: theme.ink,
            outline: 'none',
            boxSizing: 'border-box',
          }}
        />
      )}
    </div>
  );
}
