import type { ChatItem } from '../../shared/contract';
import type { Deps } from '../deps';

export const findMessage = (d: Deps, clientId: string): ChatItem | undefined =>
  d.store.getState().messages.find((m) => m.clientId === clientId);
