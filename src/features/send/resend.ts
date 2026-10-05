import type { Deps } from '../deps';

const ACK_TIMEOUT_MS = 10_000;

/**
 * Один шаг доставки: отправить pending-сообщение (идемпотентно по clientId).
 * offline — остаётся pending (дошлёт outbox); нет ack за 10 с — failed.
 */
export async function resendMessage(
  d: Pick<Deps, 'store' | 'transport' | 'session' | 'timers'>,
  { clientId }: { clientId: string },
): Promise<void> {
  const msg = d.store.getState().messages.find((m) => m.clientId === clientId);
  if (!msg || msg.status !== 'pending') return;

  const epoch = d.session.epoch();
  d.timers.set(`ack:${clientId}`, () => d.store.getState().markFailed(clientId), ACK_TIMEOUT_MS);
  try {
    const ack = await d.transport.send(clientId, msg.text);
    if (!d.session.assertEpoch(epoch)) return; // связь рвалась: статус решит outbox после reconnect
    d.timers.clear(`ack:${clientId}`);
    d.store.getState().markSent(clientId, ack.id);
  } catch (e) {
    d.timers.clear(`ack:${clientId}`);
    if (!(e instanceof Error && e.message === 'offline')) d.store.getState().markFailed(clientId);
  }
}
