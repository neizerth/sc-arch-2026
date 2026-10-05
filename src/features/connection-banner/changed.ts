import { sample } from 'effector';
import type { Domain } from 'effector';
import type { Connection } from '../../shared/contract';
import { delay } from '../delay';
import type { Deps } from '../deps';
import type { Events } from '../events';

const BANNER_DELAY_MS = 3_000;

/** changed → setConnection; reconnecting → новый epoch + delay 3 с → баннер (если всё ещё reconnecting); connected → hide + flush. */
export function setupConnection(d: Deps, ev: Events, domain: Domain): void {
  const setConnectionFx = domain.createEffect((s: Connection) => d.store.getState().setConnection(s));
  const reconnectingFx = domain.createEffect(() => d.session.reconnecting());
  const connectedFx = domain.createEffect(() => d.session.connected());
  const showBannerFx = domain.createEffect(() => d.store.getState().showBanner());
  const hideBannerFx = domain.createEffect(() => d.store.getState().hideBanner());

  const changed = ev['connection/changed'];
  sample({ clock: changed, fn: ({ state }) => state, target: setConnectionFx });

  const reconnecting = sample({ clock: changed, filter: ({ state }) => state === 'reconnecting' });
  sample({ clock: reconnecting, target: reconnectingFx });
  const bannerDue = delay(domain, reconnecting, BANNER_DELAY_MS);
  sample({ clock: bannerDue, filter: () => d.store.getState().connection === 'reconnecting', target: showBannerFx });

  const connected = sample({ clock: changed, filter: ({ state }) => state === 'connected' });
  sample({ clock: connected, target: [connectedFx, hideBannerFx, ev['outbox/flush']] });
}
