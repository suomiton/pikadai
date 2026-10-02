import { useEffect, useState } from 'react';

/** Braille spinner frames: the font ships the braille block, so they render in-family. */
const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

interface Props {
  steps: readonly string[];
  /** Index of the step in progress; equal to steps.length - 1 with the last step meaning "done". */
  current: number;
  failed?: boolean;
}

export function ProgressSteps({ steps, current, failed = false }: Props) {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setFrame((f) => (f + 1) % FRAMES.length), 80);
    return () => clearInterval(timer);
  }, []);

  const lastIndex = steps.length - 1;

  return (
    <ol className="progress-steps" aria-live="polite">
      {steps.map((label, i) => {
        let state: 'done' | 'active' | 'failed' | 'pending';
        if (i < current || (i === current && i === lastIndex && !failed)) state = 'done';
        else if (i === current) state = failed ? 'failed' : 'active';
        else state = 'pending';

        const icon =
          state === 'done' ? '✓' : state === 'active' ? FRAMES[frame] : state === 'failed' ? '✕' : '·';

        return (
          <li key={label} className={`step is-${state}`}>
            <span className="step-icon" aria-hidden="true">
              {icon}
            </span>
            <span className="step-label">
              {label}
              {state === 'active' && <span className="dots" aria-hidden="true" />}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
