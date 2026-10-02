import { useRef, useState } from 'react';

interface Props {
  label: string;
  value: string;
  hint?: string;
}

export function CopyField({ label, value, hint }: Props) {
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      inputRef.current?.select();
    }
  }

  return (
    <div className="copy-field">
      <span className="field-label">{label}</span>
      <div className="copy-row">
        <input
          ref={inputRef}
          className="input"
          readOnly
          value={value}
          onFocus={(e) => e.currentTarget.select()}
          aria-label={label}
        />
        <button type="button" className="btn btn-secondary" onClick={copy}>
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      {hint && <p className="hint">{hint}</p>}
    </div>
  );
}
