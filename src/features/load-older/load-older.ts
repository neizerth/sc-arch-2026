import { sample } from 'effector';
import type { Domain } from 'effector';
import type { Message } from '../../shared/contract';
import type { Deps } from '../deps';
import type { Events } from '../events';

interface Request { beforeId?: string; epoch: number }

/** loadOlder: игнор при loadingOlder/!hasOlder → started → loadHistoryFx → done | failed (в т.ч. старый epoch). */
export function setupLoadOlder(d: Deps, ev: Events, domain: Domain): void {
  const loadHistoryFx = domain.createEffect((r: Request) => d.transport.loadHistory(r.beforeId));
  const startedFx = domain.createEffect(() => d.store.getState().loadOlderStarted());
  const failedFx = domain.createEffect(() => d.store.getState().loadOlderFailed());
  const doneFx = domain.createEffect((page: { messages: Message[]; hasMore: boolean }) =>
    d.store.getState().loadOlderDone(page.messages, page.hasMore),
  );

  sample({
    clock: ev['history/loadOlder'],
    filter: () => !d.store.getState().loadingOlder && d.store.getState().hasOlder,
    fn: () => ({ beforeId: d.store.getState().messages.find((m) => m.status === 'sent')?.id, epoch: d.session.epoch() }),
    target: [startedFx, loadHistoryFx],
  });
  sample({
    clock: loadHistoryFx.finally,
    filter: (r) => r.status === 'done' && d.session.assertEpoch(r.params.epoch),
    fn: (r) => (r.status === 'done' ? r.result : { messages: [], hasMore: false }),
    target: doneFx,
  });
  sample({
    clock: loadHistoryFx.finally,
    filter: (r) => r.status === 'fail' || !d.session.assertEpoch(r.params.epoch),
    target: failedFx,
  });
}
