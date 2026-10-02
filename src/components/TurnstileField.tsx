import { Turnstile, type TurnstileInstance } from '@marsidev/react-turnstile';
import type { Ref } from 'react';

const SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY;

interface Props {
  onToken: (token: string | null) => void;
  ref?: Ref<TurnstileInstance>;
}

export function TurnstileField({ onToken, ref }: Props) {
  if (!SITE_KEY) {
    return (
      <p className="form-error" role="alert">
        Turnstile is not configured: set VITE_TURNSTILE_SITE_KEY.
      </p>
    );
  }
  return (
    <div className="turnstile">
      <Turnstile
        ref={ref}
        siteKey={SITE_KEY}
        onSuccess={onToken}
        onExpire={() => onToken(null)}
        onError={() => onToken(null)}
        options={{ theme: 'auto', size: 'flexible' }}
      />
    </div>
  );
}
