import { sample } from 'effector';
import type { Domain } from 'effector';
import type { Deps } from '../deps';
import type { Events } from '../events';

/** flush: берём pending из стора и независимо запускаем message/resend для каждого (не ждём). */
export function setupFlush(d: Deps, ev: Events, domain: Domain): void {
  const resendAllFx = domain.createEffect((ids: string[]) => {
    for (const clientId of ids) d.dispatch('message/resend', { clientId });
  });
  sample({
    clock: ev['outbox/flush'],
    fn: () => d.store.getState().messages.flatMap((m) => (m.status === 'pending' && m.clientId ? [m.clientId] : [])),
    target: resendAllFx,
  });
}
