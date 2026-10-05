import type { Deps } from '../deps';

/** outbox/flush: независимая работа по каждому pending — запускаем dispatch'ем и не ждём. */
export function flushOutbox(d: Pick<Deps, 'store' | 'dispatch'>): void {
  for (const m of d.store.getState().messages) {
    if (m.status === 'pending' && m.clientId) d.dispatch('message/resend', { clientId: m.clientId });
  }
}
