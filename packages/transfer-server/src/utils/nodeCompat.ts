/**
 * Runtime compatibility shims. Imported for its side effect and must run before
 * any dependency that touches browser globals.
 */

type IStorageLike = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
  clear: () => void;
  key: (index: number) => string | null;
  length: number;
};

function createMemoryStorage(): IStorageLike {
  const store = new Map<string, string>();
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, String(value));
    },
    removeItem: (key) => {
      store.delete(key);
    },
    clear: () => store.clear(),
    key: (index) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  };
}

function isUsableStorage(candidate: unknown): boolean {
  try {
    const storage = candidate as IStorageLike | undefined | null;
    if (!storage || typeof storage.getItem !== 'function') {
      return false;
    }
    // Node defines the global but throws on access when no backing file is set
    storage.getItem('__storage_probe__');
    return true;
  } catch {
    return false;
  }
}

/**
 * Node 22 shipped an experimental Web Storage API and Node 25 exposes
 * `localStorage` on the global by default. Without `--localstorage-file` the
 * object is present but unusable: `typeof localStorage` is `'object'` while
 * `localStorage.getItem` is `undefined`.
 *
 * `@onekeyfe/cross-inpage-provider-core` guards with
 * `typeof localStorage === 'undefined'` and then calls `getItem()` while its
 * module is being evaluated, so on Node 25 importing it kills the process
 * before the server starts:
 *
 *     TypeError: localStorage.getItem is not a function
 *         at getStoredLogConfig (.../loggerConsole.js:17:33)
 *
 * Node 24 has no such global and takes the guarded path, which is why this only
 * shows up on a runtime bump. Replacing an unusable global with an in-memory
 * stub keeps both versions on the same code path; nothing server side should be
 * reading browser storage anyway.
 */
export function installBrowserStorageStub(): void {
  const globalObject = globalThis as unknown as Record<string, unknown>;

  for (const name of ['localStorage', 'sessionStorage']) {
    let current: unknown;
    try {
      current = globalObject[name];
    } catch {
      // the getter itself can throw depending on how the runtime was started
      current = undefined;
    }

    if (isUsableStorage(current)) {
      continue;
    }

    Object.defineProperty(globalObject, name, {
      value: createMemoryStorage(),
      configurable: true,
      writable: true,
    });
  }
}

installBrowserStorageStub();
