import { describe, expect, it } from 'bun:test';

import {
  buildRelevantMemoryCandidates,
  selectRelevantMemory,
  type RelevantMemoryCandidate,
} from '../../../../src/core/memory/relevant-retrieval.js';

describe('relevant-retrieval', () => {
  it('builds candidates from context knowledge and project metadata', () => {
    const candidates = buildRelevantMemoryCandidates({
      repoPath: '/repo',
      instruction: 'respect project rules',
      rgSnippets: [],
      knowledgeBase: {
        project_rules: ['Always use apply_patch', 'Keep prompts deterministic'],
        architectural_decisions: [
          {
            date: '2026-04-23',
            decision: 'Keep flowMode as the primary orchestration selector.',
            related_files: ['src/core/grizzco/flows/SalmonLoopFlow.ts'],
          },
        ],
        user_preferences: 'Prefer concise review output.',
      },
      projectMetadata: {
        aiInstructions: 'Read CLAUDE.md before making architectural changes.',
      },
    });

    expect(candidates.map((candidate) => candidate.path)).toEqual([
      '.salmonloop/knowledge/project_rules',
      '.salmonloop/knowledge/user_preferences',
      '.salmonloop/knowledge/architectural_decisions/1',
      '.salmonloop/project/ai-instructions',
    ]);
    expect(candidates[0]?.summary).toContain('Always use apply_patch');
    expect(candidates[2]?.tags).toContain('src/core/grizzco/flows/salmonloopflow.ts');
  });

  it('does not resurface used memory, suppresses active-tool docs, and returns a bounded set', () => {
    const candidates: RelevantMemoryCandidate[] = [
      {
        path: '/repo/docs/tool-doc.md',
        title: 'fs.read tool guide',
        summary: 'Detailed guidance for fs.read arguments and usage.',
        tags: ['tool:fs.read'],
      },
      {
        path: '/repo/docs/retry-contract.md',
        title: 'Retry correction contract',
        summary: 'Structured correction hints for invalid tool arguments and retry loops.',
        tags: ['retries', 'tools'],
      },
      {
        path: '/repo/docs/request-assembly.md',
        title: 'Request assembly memory notes',
        summary: 'Inject concise relevant memory blocks into assembled prompts.',
        tags: ['prompts', 'assembly'],
      },
      {
        path: '/repo/docs/summary-sync.md',
        title: 'Summary sync recovery',
        summary: 'Preserve recovery state across compaction boundaries.',
        tags: ['compaction', 'recovery'],
      },
    ];

    const result = selectRelevantMemory({
      instruction: 'improve request assembly retry prompts',
      candidates,
      activeToolNames: ['fs.read'],
      alreadySurfacedText: [
        'Earlier context already used /repo/docs/summary-sync.md for recovery state discussion.',
      ],
      maxItems: 2,
    });

    expect(result).toHaveLength(2);
    expect(result).not.toContainEqual(
      expect.objectContaining({ path: '/repo/docs/tool-doc.md' }),
    );
    expect(result).not.toContainEqual(
      expect.objectContaining({ path: '/repo/docs/summary-sync.md' }),
    );
    expect(result.map((item) => item.path)).toEqual([
      '/repo/docs/request-assembly.md',
      '/repo/docs/retry-contract.md',
    ]);
  });
});
