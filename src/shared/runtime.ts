// Мелкие сервисы для Deps. Создаются на каждый инстанс чата, без модульного состояния.

export interface Timers {
  /** Один таймер на ключ: повторный set с тем же ключом заменяет предыдущий. */
  set(key: string, cb: () => void, ms: number): void;
  clear(key: string): void;
  clearAll(): void;
}
export interface Ids { clientId(): string }
export interface Clock { now(): number }

export function createTimers(): Timers {
  const active = new Map<string, ReturnType<typeof setTimeout>>();
  const clear = (key: string) => {
    clearTimeout(active.get(key));
    active.delete(key);
  };
  return {
    set(key, cb, ms) {
      clear(key);
      active.set(key, setTimeout(() => { active.delete(key); cb(); }, ms));
    },
    clear,
    clearAll() { [...active.keys()].forEach(clear); },
  };
}

export function createIds(): Ids {
  let n = 0;
  return { clientId: () => `c${++n}` };
}

export const createClock = (): Clock => ({ now: () => Date.now() });
