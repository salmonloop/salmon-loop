export type ResourceKey =
  | { kind: 'repo'; id: string }
  | { kind: 'pathPrefix'; repoId: string; prefix: string }
  | { kind: 'snapshot'; id: string }
  | { kind: 'network'; scope: 'global' | 'host' }
  | { kind: 'process'; scope: 'global' | 'repo'; repoId?: string };

export type LockMode = 'read' | 'write';

export interface LockHandle {
  release(): void;
}

export interface LockManager {
  acquire(keys: ResourceKey[], mode: LockMode, signal: AbortSignal): Promise<LockHandle>;
}
