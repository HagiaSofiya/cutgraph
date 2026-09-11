import '@testing-library/jest-dom/vitest';

// jsdom (as of the version pinned here) defers to Node's native localStorage, which stays
// undefined unless the process is launched with --localstorage-file. Rather than depend on a
// CLI flag, shim a plain in-memory Storage for the test environment only.
if (typeof globalThis.localStorage === 'undefined') {
  class MemoryStorage implements Storage {
    private store = new Map<string, string>();

    get length(): number {
      return this.store.size;
    }

    clear(): void {
      this.store.clear();
    }

    getItem(key: string): string | null {
      return this.store.has(key) ? this.store.get(key)! : null;
    }

    key(index: number): string | null {
      return Array.from(this.store.keys())[index] ?? null;
    }

    removeItem(key: string): void {
      this.store.delete(key);
    }

    setItem(key: string, value: string): void {
      this.store.set(key, String(value));
    }
  }

  const storage = new MemoryStorage();
  Object.defineProperty(globalThis, 'localStorage', { value: storage, writable: true, configurable: true });
  if (typeof window !== 'undefined') {
    Object.defineProperty(window, 'localStorage', { value: storage, writable: true, configurable: true });
  }
}
