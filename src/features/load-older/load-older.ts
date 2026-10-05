import type { Deps } from '../deps';

/** history/loadOlder: первая страница и подгрузка вверх. Повторный вызов во время загрузки игнорируется. */
export async function loadOlder(d: Pick<Deps, 'store' | 'transport' | 'session'>): Promise<void> {
  const s = d.store.getState();
  if (s.loadingOlder || !s.hasOlder) return;

  s.loadOlderStarted();
  const epoch = d.session.epoch();
  const beforeId = s.messages.find((m) => m.status === 'sent')?.id; // самое старое серверное
  try {
    const page = await d.transport.loadHistory(beforeId);
    if (!d.session.assertEpoch(epoch)) return s.loadOlderFailed();
    s.loadOlderDone(page.messages, page.hasMore);
  } catch {
    s.loadOlderFailed();
  }
}
