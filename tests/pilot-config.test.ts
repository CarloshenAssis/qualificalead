import { describe, expect, it } from 'vitest';
import { mayCallApify, maySendRealEmail, pilotFlags, strictFlag } from '@/lib/pilot/config';

describe('feature flags fail-closed', () => {
  it.each([undefined, '', '1', 'yes', 'invalid', 'false'])('valor %s não habilita', (value) => expect(strictFlag(value)).toBe(false));
  it('ausência mantém Apify e envio desligados e dry-run ligado', () => expect(pilotFlags({ NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toEqual({ apifyEnabled: false, emailSendingEnabled: false, emailDryRun: true }));
  it('teste nunca chama serviços pagos', () => {
    const env = { NODE_ENV: 'test', APIFY_ENABLED: 'true', EMAIL_SENDING_ENABLED: 'true', EMAIL_DRY_RUN: 'false', POSTGRES_VALIDATED: 'true', EMAIL_DNS_VALIDATED: 'true' } as NodeJS.ProcessEnv;
    expect(mayCallApify(env)).toBe(false); expect(maySendRealEmail(env)).toBe(false);
  });
  it('envio real exige flags e gates externos validados', () => {
    const base = { NODE_ENV: 'production', EMAIL_SENDING_ENABLED: 'true', EMAIL_DRY_RUN: 'false' } as NodeJS.ProcessEnv;
    expect(maySendRealEmail(base)).toBe(false);
    expect(maySendRealEmail({ ...base, POSTGRES_VALIDATED: 'true', EMAIL_DNS_VALIDATED: 'true' })).toBe(true);
  });
});
