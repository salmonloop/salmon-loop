import { LockHandle, LockManager, LockMode, ResourceKey } from './resources.js';

type KeyStr = string;

function keyToString(k: ResourceKey): KeyStr {
  switch (k.kind) {
    case 'repo':
      return `repo:${k.id}`;
    case 'pathPrefix':
      return `path:${k.repoId}:${k.prefix}`;
    case 'snapshot':
      return `snap:${k.id}`;
    case 'network':
      return `net:${k.scope}`;
    case 'process':
      return `proc:${k.scope}:${k.repoId ?? ''}`;
  }
}

class RWLock {
  private readers = 0;
  private writer = false;
  private queue: Array<{
    mode: LockMode;
    resolve: (release: () => void) => void;
    reject: (e: any) => void;
    signal: AbortSignal;
    onAbort: () => void;
  }> = [];

  async acquire(mode: LockMode, signal: AbortSignal): Promise<() => void> {
    if (signal.aborted) throw new Error('Lock acquisition aborted');

    return new Promise<() => void>((resolve, reject) => {
      const onAbort = () => {
        const idx = this.queue.findIndex((q) => q.resolve === resolve);
        if (idx !== -1) {
          this.queue.splice(idx, 1);
        }
        reject(new Error('Lock acquisition aborted'));
      };

      signal.addEventListener('abort', onAbort, { once: true });

      const tryAcquire = () => {
        if (mode === 'read') {
          if (!this.writer && this.queue.length === 0) {
            this.readers++;
            signal.removeEventListener('abort', onAbort);
            return resolve(() => this.releaseRead());
          }
        } else {
          if (!this.writer && this.readers === 0) {
            this.writer = true;
            signal.removeEventListener('abort', onAbort);
            return resolve(() => this.releaseWrite());
          }
        }

        this.queue.push({ mode, resolve, reject, signal, onAbort });
      };

      tryAcquire();
    });
  }

  private releaseRead() {
    this.readers--;
    this.drain();
  }

  private releaseWrite() {
    this.writer = false;
    this.drain();
  }

  private drain() {
    if (this.writer) return;

    // Writer priority to avoid starvation
    const nextWriterIdx = this.queue.findIndex((q) => q.mode === 'write');
    if (nextWriterIdx === 0 && this.readers === 0) {
      const w = this.queue.shift()!;
      w.signal.removeEventListener('abort', w.onAbort);
      this.writer = true;
      w.resolve(() => this.releaseWrite());
      return;
    }

    // Release all consecutive readers at the front
    while (this.queue.length > 0 && this.queue[0].mode === 'read' && !this.writer) {
      const r = this.queue.shift()!;
      this.readers++;
      r.signal.removeEventListener('abort', r.onAbort);
      r.resolve(() => this.releaseRead());
    }

    // If head is write and no readers, release it
    if (
      this.queue.length > 0 &&
      this.queue[0].mode === 'write' &&
      this.readers === 0 &&
      !this.writer
    ) {
      const w = this.queue.shift()!;
      this.writer = true;
      w.signal.removeEventListener('abort', w.onAbort);
      w.resolve(() => this.releaseWrite());
    }
  }
}

export class InMemoryLockManager implements LockManager {
  private locks = new Map<KeyStr, RWLock>();

  async acquire(keys: ResourceKey[], mode: LockMode, signal: AbortSignal): Promise<LockHandle> {
    // Sort keys to prevent ABBA deadlocks
    const ks = [...keys].map(keyToString).sort();
    const releases: Array<() => void> = [];

    try {
      for (const k of ks) {
        let lock = this.locks.get(k);
        if (!lock) {
          lock = new RWLock();
          this.locks.set(k, lock);
        }

        const release = await lock.acquire(mode, signal);
        releases.push(release);
      }
    } catch (e) {
      // Rollback: release all acquired locks in reverse order
      for (let i = releases.length - 1; i >= 0; i--) {
        releases[i]();
      }
      throw e;
    }

    return {
      release() {
        // Release in reverse order of acquisition
        for (let i = releases.length - 1; i >= 0; i--) {
          releases[i]();
        }
      },
    };
  }
}
