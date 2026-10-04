import { useRef, useState } from 'react';
import { StatusAnnouncer } from './StatusAnnouncer';

interface Props {
  label: string;
  value: string;
  hint?: string;
}

export function CopyField({ label, value, hint }: Props) {
  const [copied, setCopied] = useState(false);
  const [status, setStatus] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setStatus(`${label} copied to clipboard.`);
      setTimeout(() => {
        setCopied(false);
        setStatus('');
      }, 1500);
    } catch {
      inputRef.current?.select();
      setStatus('Could not copy automatically. The link is selected; copy it with your keyboard.');
    }
  };

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
      {/* Button text alone is not announced when it changes; this is. */}
      <StatusAnnouncer message={status} />
      {hint && <p className="hint">{hint}</p>}
    </div>
  );
}
