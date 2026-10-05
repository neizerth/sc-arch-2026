import { sample } from 'effector';
import type { Domain } from 'effector';
import { delay } from '../delay';
import type { Deps } from '../deps';
import { findMessage } from './lookup';
import type { SendPorts } from './ports';

const ACK_TIMEOUT_MS = 10_000;
const isOffline = (e: unknown) => e instanceof Error && e.message === 'offline';

/** Результат отправки: ack → sent, ошибка → failed (offline — остаётся pending), нет ack за 10 с → failed. */
export function wireAck(d: Deps, domain: Domain, p: SendPorts): void {
  sample({
    clock: p.sendFx.done,
    filter: ({ params }) => d.session.assertEpoch(params.epoch),
    fn: ({ params, result }) => ({ clientId: params.clientId, id: result.id }),
    target: p.markSentFx,
  });
  sample({
    clock: p.sendFx.fail,
    filter: ({ error }) => !isOffline(error),
    fn: ({ params }) => params.clientId,
    target: p.markFailedFx,
  });
  const ackTimeout = delay(domain, p.sendFx, ACK_TIMEOUT_MS);
  sample({
    clock: ackTimeout,
    source: p.$inflight,
    filter: (inflight, a) => (inflight[a.clientId] ?? 0) > 0 && findMessage(d, a.clientId)?.status === 'pending',
    fn: (_, a) => a.clientId,
    target: p.markFailedFx,
  });
}
