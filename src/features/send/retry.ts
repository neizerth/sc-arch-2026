import { Effect } from 'effect';
import { StoreService } from '../services';
import { resendMessage } from './resend';

/** message/retry: ручной повтор только для failed, с тем же clientId. */
export const retryMessage = ({ clientId }: { clientId: string }) =>
  Effect.gen(function* () {
    const store = yield* StoreService;
    const msg = store.getState().messages.find((m) => m.clientId === clientId);
    if (msg?.status !== 'failed') return;
    store.getState().markPending(clientId);
    yield* resendMessage({ clientId });
  });
