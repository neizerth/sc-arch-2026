import type { Domain } from 'effector';
import type { ChatItem } from '../../shared/contract';
import type { Deps } from '../deps';

/** Одна попытка отправки: epoch запоминаем на старте, чтобы отбросить результат старого поколения. */
export interface Attempt { clientId: string; text: string; epoch: number }

/** Порты процесса отправки: побочки (транспорт, действия среза) — только эффекты. */
export function createSendPorts(d: Deps, domain: Domain) {
  const sendFx = domain.createEffect((a: Attempt) => d.transport.send(a.clientId, a.text));
  const addPendingFx = domain.createEffect((item: ChatItem) => d.store.getState().addPending(item));
  const markPendingFx = domain.createEffect((clientId: string) => d.store.getState().markPending(clientId));
  const markFailedFx = domain.createEffect((clientId: string) => d.store.getState().markFailed(clientId));
  const markSentFx = domain.createEffect((p: { clientId: string; id: string }) =>
    d.store.getState().markSent(p.clientId, p.id),
  );
  // Служебный счётчик «запрос в полёте» (не данные чата): offline-ответ снимает ожидание ack.
  const $inflight = domain
    .createStore<Record<string, number>>({})
    .on(sendFx, (m, a) => ({ ...m, [a.clientId]: (m[a.clientId] ?? 0) + 1 }))
    .on(sendFx.finally, (m, { params: a }) => ({ ...m, [a.clientId]: Math.max(0, (m[a.clientId] ?? 1) - 1) }));
  return { sendFx, addPendingFx, markPendingFx, markFailedFx, markSentFx, $inflight };
}
export type SendPorts = ReturnType<typeof createSendPorts>;
