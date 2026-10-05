import type { Deps } from '../deps';
import type { Message } from '../../shared/contract';

/** message/receive: слияние входящего (чужое, эхо своего, дубликат) делает срез. */
export function receiveMessage(d: Pick<Deps, 'store'>, { message }: { message: Message }): void {
  d.store.getState().receive(message);
}
