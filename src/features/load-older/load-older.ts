import { Effect } from 'effect';
import { HistoryFailed, StaleEpoch } from '../errors';
import { SessionService, StoreService, TransportService } from '../services';

/** history/loadOlder: первая страница и подгрузка вверх. Повтор во время загрузки игнорируется (флаг среза). */
export const loadOlder = () =>
  Effect.gen(function* () {
    const store = yield* StoreService;
    const transport = yield* TransportService;
    const session = yield* SessionService;
    const s = store.getState();
    if (s.loadingOlder || !s.hasOlder) return;

    s.loadOlderStarted();
    const epoch = session.epoch();
    const beforeId = s.messages.find((m) => m.status === 'sent')?.id; // самое старое серверное
    const page = yield* Effect.tryPromise({
      try: () => transport.loadHistory(beforeId),
      catch: (cause) => new HistoryFailed({ cause }),
    });
    if (!session.assertEpoch(epoch)) return yield* Effect.fail(new StaleEpoch());
    s.loadOlderDone(page.messages, page.hasMore);
  }).pipe(
    Effect.catchTags({
      HistoryFailed: () => StoreService.useSync((s) => s.getState().loadOlderFailed()),
      StaleEpoch: () => StoreService.useSync((s) => s.getState().loadOlderFailed()),
    }),
  );
