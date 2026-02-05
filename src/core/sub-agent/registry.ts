import { SubAgentProfile } from './types.js';

export class SubAgentRegistry {
  private static profiles = new Map<string, SubAgentProfile>();

  static register(profile: SubAgentProfile): void {
    this.profiles.set(profile.id, profile);
  }

  static get(id: string): SubAgentProfile | undefined {
    return this.profiles.get(id);
  }

  static getAll(): SubAgentProfile[] {
    return Array.from(this.profiles.values());
  }

  static clear(): void {
    this.profiles.clear();
  }
}

// Register Default "Smallfrys"
SubAgentRegistry.register({
  id: 'explorer',
  name: 'Scout Smallfry',
  role: 'Explorer',
  description: 'Specializes in navigating the codebase and finding relevant context.',
  allowedTools: ['code.search', 'fs.read', 'git.status', 'git.cat', 'code.ast'],
  readOnly: true,
  stratagem: 'investigator',
  maxTokens: 50000,
  maxAttempts: 3,
});

SubAgentRegistry.register({
  id: 'surgeon',
  name: 'Smallfry Developer',
  role: 'Coder',
  description: 'Capable of making targeted code changes and verifying them.',
  allowedTools: ['code.search', 'fs.read', 'test.run', 'code.ast'],
  readOnly: false,
  stratagem: 'surgeon',
  maxTokens: 100000,
  maxAttempts: 5,
});

SubAgentRegistry.register({
  id: 'reviewer',
  name: 'Reviewer Smallfry',
  role: 'Auditor',
  description: 'Specializes in code audit and security reviews. No mutation allowed.',
  allowedTools: ['code.search', 'fs.read', 'code.ast'],
  readOnly: true,
  stratagem: 'investigator',
  maxTokens: 30000,
  maxAttempts: 2,
});

SubAgentRegistry.register({
  id: 'cleaner',
  name: 'Cleaner Smallfry',
  role: 'Maintainer',
  description: 'Focused on fixing linting, formatting, and minor cleanup.',
  allowedTools: ['fs.read', 'test.run', 'code.search'],
  readOnly: false,
  stratagem: 'surgeon',
  maxTokens: 50000,
  maxAttempts: 3,
});
