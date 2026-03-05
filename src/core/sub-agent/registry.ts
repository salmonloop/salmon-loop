import { SubAgentProfile } from './types.js';

export class SubAgentRegistry {
  private readonly profiles = new Map<string, SubAgentProfile>();

  register(profile: SubAgentProfile): void {
    this.profiles.set(profile.id, profile);
  }

  get(id: string): SubAgentProfile | undefined {
    return this.profiles.get(id);
  }

  getAll(): SubAgentProfile[] {
    return Array.from(this.profiles.values());
  }

  clear(): void {
    this.profiles.clear();
  }
}

export function createSubAgentRegistry(): SubAgentRegistry {
  return new SubAgentRegistry();
}

let activeSubAgentRegistry: SubAgentRegistry | null = null;

export function setSubAgentRegistry(registry: SubAgentRegistry): void {
  activeSubAgentRegistry = registry;
}

export function getSubAgentRegistry(): SubAgentRegistry {
  if (!activeSubAgentRegistry) {
    throw new Error('SubAgentRegistry is not initialized. Call setSubAgentRegistry() at startup.');
  }
  return activeSubAgentRegistry;
}

export function tryGetSubAgentRegistry(): SubAgentRegistry | null {
  return activeSubAgentRegistry;
}

export function clearSubAgentRegistry(): void {
  activeSubAgentRegistry = null;
}
