import { Turnstile, type TurnstileInstance } from '@marsidev/react-turnstile';
import type { Ref } from 'react';
import type { TurnstileAction } from '@shared/types';
import { FormError } from './FormError';

const SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY;

interface Props {
  /** Rendered into the token; the Worker only accepts the token for the same action. */
  action: TurnstileAction;
  onToken: (token: string | null) => void;
  ref?: Ref<TurnstileInstance>;
}

export function TurnstileField({ action, onToken, ref }: Props) {
  if (!SITE_KEY) return <FormError message="Turnstile is not configured: set VITE_TURNSTILE_SITE_KEY." />;
  return (
    <div className="turnstile">
      <Turnstile
        ref={ref}
        siteKey={SITE_KEY}
        onSuccess={onToken}
        onExpire={() => onToken(null)}
        onError={() => onToken(null)}
        options={{ theme: 'auto', size: 'flexible', action }}
      />
    </div>
  );
}
