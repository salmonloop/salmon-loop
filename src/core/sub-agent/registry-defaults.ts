import type { SubAgentRegistry } from './registry.js';
import type { SubAgentProfile } from './types.js';

const DEFAULT_SUB_AGENT_PROFILES: SubAgentProfile[] = [
  {
    id: 'explorer',
    name: 'Scout Smallfry',
    role: 'Explorer',
    description: 'Specializes in navigating the codebase and finding relevant context.',
    allowedTools: ['code.search', 'fs.read', 'git.status', 'git.cat', 'code.ast'],
    readOnly: true,
    stratagem: 'investigator',
    maxTokens: 50000,
    maxAttempts: 3,
  },
  {
    id: 'surgeon',
    name: 'Smallfry Developer',
    role: 'Coder',
    description: 'Capable of making targeted code changes and verifying them.',
    allowedTools: ['code.search', 'fs.read', 'test.run', 'code.ast'],
    readOnly: false,
    stratagem: 'surgeon',
    maxTokens: 100000,
    maxAttempts: 5,
  },
  {
    id: 'reviewer',
    name: 'Reviewer Smallfry',
    role: 'Auditor',
    description: 'Specializes in code audit and security reviews. No mutation allowed.',
    allowedTools: ['code.search', 'fs.read', 'code.ast'],
    readOnly: true,
    stratagem: 'investigator',
    maxTokens: 30000,
    maxAttempts: 2,
  },
  {
    id: 'cleaner',
    name: 'Cleaner Smallfry',
    role: 'Maintainer',
    description: 'Focused on fixing linting, formatting, and minor cleanup.',
    allowedTools: ['fs.read', 'test.run', 'code.search'],
    readOnly: false,
    stratagem: 'surgeon',
    maxTokens: 50000,
    maxAttempts: 3,
  },
];

export function registerDefaultSubAgentProfiles(registry: SubAgentRegistry): void {
  for (const profile of DEFAULT_SUB_AGENT_PROFILES) {
    registry.register(profile);
  }
}
