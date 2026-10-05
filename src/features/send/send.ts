import type { Deps } from '../deps';
import { resendMessage } from './resend';

type SendDeps = Pick<Deps, 'store' | 'transport' | 'session' | 'timers' | 'ids' | 'clock'>;

/** message/send: оптимистичное pending в стор, затем доставка (шаг процесса — прямой await). */
export async function sendMessage(d: SendDeps, { text }: { text: string }): Promise<void> {
  const clientId = d.ids.clientId();
  d.store.getState().addPending({
    id: clientId,
    clientId,
    text,
    author: 'me',
    createdAt: d.clock.now(),
    status: 'pending',
  });
  await resendMessage(d, { clientId });
}
