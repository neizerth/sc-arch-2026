import type { Deps } from '../deps';
import { resendMessage } from './resend';

/** message/retry: ручной повтор только для failed, с тем же clientId. */
export async function retryMessage(
  d: Pick<Deps, 'store' | 'transport' | 'session' | 'timers'>,
  { clientId }: { clientId: string },
): Promise<void> {
  const msg = d.store.getState().messages.find((m) => m.clientId === clientId);
  if (msg?.status !== 'failed') return;
  d.store.getState().markPending(clientId);
  await resendMessage(d, { clientId });
}
