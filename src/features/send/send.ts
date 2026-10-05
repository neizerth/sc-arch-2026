import { sample } from 'effector';
import type { Domain } from 'effector';
import type { ChatItem } from '../../shared/contract';
import type { Deps } from '../deps';
import type { Events } from '../events';
import { wireAck } from './ack';
import { findMessage } from './lookup';
import { createSendPorts } from './ports';

/** send: addPending → resend; resend: pending → sendFx; retry: failed → markPending → resend. */
export function setupSend(d: Deps, ev: Events, domain: Domain): void {
  const p = createSendPorts(d, domain);

  sample({
    clock: ev['message/send'],
    fn: ({ text }): ChatItem => {
      const clientId = d.ids.clientId();
      return { id: clientId, clientId, text, author: 'me', createdAt: d.clock.now(), status: 'pending' };
    },
    target: p.addPendingFx,
  });
  sample({ clock: p.addPendingFx.done, fn: ({ params }) => ({ clientId: params.id }), target: ev['message/resend'] });

  sample({
    clock: ev['message/resend'],
    filter: ({ clientId }) => findMessage(d, clientId)?.status === 'pending',
    fn: ({ clientId }) => ({ clientId, text: findMessage(d, clientId)?.text ?? '', epoch: d.session.epoch() }),
    target: p.sendFx,
  });

  sample({
    clock: ev['message/retry'],
    filter: ({ clientId }) => findMessage(d, clientId)?.status === 'failed',
    fn: ({ clientId }) => clientId,
    target: p.markPendingFx,
  });
  sample({ clock: p.markPendingFx.done, fn: ({ params }) => ({ clientId: params }), target: ev['message/resend'] });

  wireAck(d, domain, p);
}
