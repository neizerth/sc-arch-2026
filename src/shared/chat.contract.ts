import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { createFakeBackend } from './backend';
import type { CreateChat } from './contract';

// Async-тест: бэкенд отвечает промисами, поэтому таймеры продвигаем асинхронно (микротаски тоже выполняются).
const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

export function describeChat(createChat: CreateChat) {
  describe('Chat', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    const setup = async () => {
      const backend = createFakeBackend();
      const chat = createChat(backend);
      const hook = renderHook(() => chat.useChat());
      await act(async () => { chat.start(); });
      await advance(500);
      return { backend, chat, result: hook.result };
    };

    it('loads 30 messages, send becomes sent exactly once', async () => {
      const { chat, result } = await setup();
      expect(result.current.messages).toHaveLength(30);
      expect(result.current.hasOlder).toBe(true);

      act(() => result.current.send('hi'));
      expect(result.current.messages.find((m) => m.text === 'hi')?.status).toBe('pending');
      await advance(500);

      const own = result.current.messages.filter((m) => m.text === 'hi');
      expect(own).toHaveLength(1);
      expect(own[0]?.status).toBe('sent');
      chat.dispose();
    });

    it('offline send stays pending, delivered once after reconnect', async () => {
      const { backend, chat, result } = await setup();
      act(() => backend.chaos.dropConnection(5000));
      await advance(1000);

      act(() => result.current.send('offline'));
      await advance(500);
      expect(result.current.messages.find((m) => m.text === 'offline')?.status).toBe('pending');

      await advance(5000);
      const own = result.current.messages.filter((m) => m.text === 'offline');
      expect(own).toHaveLength(1);
      expect(own[0]?.status).toBe('sent');
      chat.dispose();
    });

    it('banner shows after 3s of reconnecting and hides on connect', async () => {
      const { backend, chat, result } = await setup();
      act(() => backend.chaos.dropConnection(5000));
      await advance(2000);
      expect(result.current.showConnectionBanner).toBe(false);
      await advance(1200);
      expect(result.current.showConnectionBanner).toBe(true);
      await advance(2000);
      expect(result.current.showConnectionBanner).toBe(false);
      chat.dispose();
    });

    it('loadOlder prepends a page; a call during loading is ignored', async () => {
      const { chat, result } = await setup();
      act(() => { result.current.loadOlder(); result.current.loadOlder(); });
      await advance(500);
      expect(result.current.messages).toHaveLength(60);
      chat.dispose();
    });
  });
}
