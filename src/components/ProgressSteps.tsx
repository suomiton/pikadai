import { useEffect, useState } from 'react';

/** Braille spinner frames: the font ships the braille block, so they render in-family. */
const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
/** Shown instead of the spinner when the user prefers reduced motion. */
const STILL_FRAME = '◐';

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

interface Props {
  steps: readonly string[];
  /** Index of the step in progress; equal to steps.length - 1 with the last step meaning "done". */
  current: number;
  failed?: boolean;
}

export function ProgressSteps({ steps, current, failed = false }: Props) {
  const [reduceMotion] = useState(prefersReducedMotion);
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    if (reduceMotion) return;
    const timer = setInterval(() => setFrame((f) => (f + 1) % FRAMES.length), 80);
    return () => clearInterval(timer);
  }, [reduceMotion]);

  const lastIndex = steps.length - 1;
  const announcement = failed
    ? `Step ${current + 1} of ${steps.length} failed: ${steps[current]}`
    : `Step ${current + 1} of ${steps.length}: ${steps[current]}`;

  return (
    <>
      {/* Screen readers hear each step change here; the list below is visual. */}
      <p className="visually-hidden" role="status">
        {announcement}
      </p>
      <ol className="progress-steps">
        {steps.map((label, i) => {
          let state: 'done' | 'active' | 'failed' | 'pending';
          if (i < current || (i === current && i === lastIndex && !failed)) state = 'done';
          else if (i === current) state = failed ? 'failed' : 'active';
          else state = 'pending';

          const spinner = reduceMotion ? STILL_FRAME : FRAMES[frame];
          const icon = state === 'done' ? '✓' : state === 'active' ? spinner : state === 'failed' ? '✕' : '·';

          return (
            <li key={label} className={`step is-${state}`} aria-current={i === current ? 'step' : undefined}>
              <span className="step-icon" aria-hidden="true">
                {icon}
              </span>
              <span className="step-label">
                {label}
                {state === 'active' && !reduceMotion && <span className="dots" aria-hidden="true" />}
              </span>
            </li>
          );
        })}
      </ol>
    </>
  );
}
