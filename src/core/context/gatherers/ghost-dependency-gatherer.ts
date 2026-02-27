import type { RelatedFileContext } from '../../types/context.js';
import { normalizePath } from '../../utils/path.js';
import type { ContextRequest } from '../types.js';

import { RipgrepGatherer } from './ripgrep-gatherer.js';

export class GhostDependencyGatherer {
  constructor(private readonly ripgrep: RipgrepGatherer) {}

  async gather(
    primaryText: string | undefined,
    req: ContextRequest,
    existingFiles: Set<string>,
  ): Promise<RelatedFileContext[]> {
    if (!primaryText) return [];

    // 1. Extract potential "Ghost Tokens" (UpperCamelCase, SCREAMING_SNAKE_CASE, or unique strings)
    const ghostTokens = Array.from(
      new Set(primaryText.match(/\b[A-Z][a-zA-Z0-9]{5,}\b|\b[A-Z_]{5,}\b/g) || []),
    ).slice(0, 10); // Limit to top 10 tokens for performance

    if (ghostTokens.length === 0) return [];

    // 2. Search for these tokens in the repo
    const snippets = await this.ripgrep.searchMultipleKeywords(
      ghostTokens,
      req.repoPath,
      req.signal,
    );

    // 3. Identify files that contain these tokens but aren't in existing dependency tree
    const ghostFiles = new Map<string, { tokens: Set<string>; count: number }>();
    const primaryPath = normalizePath(req.primaryFile || '');

    for (const s of snippets) {
      const sPath = normalizePath(s.file);
      if (sPath === primaryPath || existingFiles.has(sPath)) continue;

      const entry = ghostFiles.get(sPath) || { tokens: new Set(), count: 0 };
      ghostTokens.forEach((t) => {
        if (s.content.includes(t)) entry.tokens.add(t);
      });
      entry.count++;
      ghostFiles.set(sPath, entry);
    }

    // 4. Rank and return top ghost candidates
    return Array.from(ghostFiles.entries())
      .filter(([_, data]) => data.tokens.size >= 1) // Must share at least one significant token
      .sort((a, b) => b[1].tokens.size - a[1].tokens.size || b[1].count - a[1].count)
      .slice(0, 3) // Only pick top 3 most likely ghosts to keep context lean
      .map(([path, data]) => ({
        path,
        kind: 'dependency' as const,
        mode: 'outline' as const,
        content: `// Ghost Dependency: Shares tokens [${Array.from(data.tokens).join(', ')}]
`,
        reason: 'ghost_dependency' as any,
      }));
  }
}
