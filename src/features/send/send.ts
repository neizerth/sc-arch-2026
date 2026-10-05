import { Effect } from 'effect';
import { ClockService, IdsService, StoreService } from '../services';
import { resendMessage } from './resend';

/** message/send: оптимистичное pending в стор (синхронно), затем доставка — прямой yield*. */
export const sendMessage = ({ text }: { text: string }) =>
  Effect.gen(function* () {
    const store = yield* StoreService;
    const clientId = (yield* IdsService).clientId();
    store.getState().addPending({
      id: clientId, clientId, text, author: 'me', createdAt: (yield* ClockService).now(), status: 'pending',
    });
    yield* resendMessage({ clientId });
  });
