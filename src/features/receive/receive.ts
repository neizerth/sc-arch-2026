import { Effect } from 'effect';
import type { Message } from '../../shared/contract';
import { StoreService } from '../services';

/** message/receive: слияние входящего (чужое, эхо своего, дубликат) делает срез. */
export const receiveMessage = ({ message }: { message: Message }) =>
  Effect.gen(function* () {
    (yield* StoreService).getState().receive(message);
  });
