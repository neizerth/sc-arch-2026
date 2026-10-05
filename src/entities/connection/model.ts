import type { Connection } from '../../shared/contract';

type Set<S> = (fn: (s: S) => Partial<S>) => void;

export interface ConnectionSlice {
  connection: Connection;
  showConnectionBanner: boolean;
  setConnection(connection: Connection): void;
  showBanner(): void;
  hideBanner(): void;
}

export const createConnectionSlice = (set: Set<ConnectionSlice>): ConnectionSlice => ({
  connection: 'connecting',
  showConnectionBanner: false,
  setConnection: (connection) => set(() => ({ connection })),
  showBanner: () => set(() => ({ showConnectionBanner: true })),
  hideBanner: () => set(() => ({ showConnectionBanner: false })),
});
