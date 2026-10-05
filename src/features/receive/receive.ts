import { sample } from 'effector';
import type { Domain } from 'effector';
import type { Message } from '../../shared/contract';
import type { Deps } from '../deps';
import type { Events } from '../events';

export function setupReceive(d: Deps, ev: Events, domain: Domain): void {
  const receiveFx = domain.createEffect((message: Message) => d.store.getState().receive(message));
  sample({ clock: ev['message/receive'], fn: ({ message }) => message, target: receiveFx });
}
