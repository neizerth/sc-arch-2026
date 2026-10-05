import type { Deps } from '../deps';
import type { Connection } from '../../shared/contract';

const BANNER_DELAY_MS = 3_000;

/**
 * connection/changed: статус в стор, сессия, баннер (reconnecting 3 с подряд),
 * при connected — независимый запуск outbox/flush.
 */
export function connectionChanged(
  d: Pick<Deps, 'store' | 'session' | 'timers' | 'dispatch'>,
  { state }: { state: Connection },
): void {
  const s = d.store.getState();
  s.setConnection(state);
  d.timers.clear('banner');
  if (state === 'reconnecting') {
    d.session.reconnecting();
    d.timers.set('banner', s.showBanner, BANNER_DELAY_MS);
  } else if (state === 'connected') {
    d.session.connected();
    s.hideBanner();
    d.dispatch('outbox/flush');
  }
}
