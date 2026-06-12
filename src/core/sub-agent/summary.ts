/**
 * Sub-agent result synthesis.
 *
 * Detects file-level conflicts between sub-agent patches
 * and generates structured summaries for parent injection.
 */

import type { SubAgentResult } from './types.js';

export interface SubAgentSummary {
  totalAgents: number;
  succeeded: number;
  failed: number;
  conflicts: Array<{ file: string; agents: string[] }>;
  totalTokens: number;
  changedFiles: string[];
}

/**
 * Extract file paths touched by a unified diff.
 * Parses diff headers (lines starting with "--- a/" and "+++ b/").
 */
export function extractDiffFiles(patch: string): string[] {
  const files = new Set<string>();
  const lines = patch.split('\n');

  for (const line of lines) {
    if (line.startsWith('+++ b/')) {
      files.add(line.slice(6));
    }
  }

  return Array.from(files);
}

/**
 * Detect file-level conflicts across multiple sub-agent results.
 * Two agents conflict if they both modify the same file.
 */
export function detectConflicts(
  results: Array<{ agentId: string; result: SubAgentResult }>,
): Array<{ file: string; agents: string[] }> {
  const fileToAgents = new Map<string, string[]>();

  for (const { agentId, result } of results) {
    if (!result.finalPatch || typeof result.finalPatch !== 'string') continue;
    const files = extractDiffFiles(result.finalPatch);
    for (const file of files) {
      const agents = fileToAgents.get(file) ?? [];
      agents.push(agentId);
      fileToAgents.set(file, agents);
    }
  }

  const conflicts: Array<{ file: string; agents: string[] }> = [];
  for (const [file, agents] of fileToAgents) {
    if (agents.length > 1) {
      conflicts.push({ file, agents });
    }
  }

  return conflicts;
}

/**
 * Generate a structured summary of all sub-agent results.
 */
export function generateSubAgentSummary(
  results: Array<{ agentId: string; result: SubAgentResult }>,
): SubAgentSummary {
  const conflicts = detectConflicts(results);
  const changedFiles = new Set<string>();

  let succeeded = 0;
  let failed = 0;
  let totalTokens = 0;

  for (const { result } of results) {
    if (result.success) succeeded++;
    else failed++;
    totalTokens += result.tokenUsage ?? 0;

    if (result.finalPatch && typeof result.finalPatch === 'string') {
      for (const file of extractDiffFiles(result.finalPatch)) {
        changedFiles.add(file);
      }
    }
  }

  return {
    totalAgents: results.length,
    succeeded,
    failed,
    conflicts,
    totalTokens,
    changedFiles: Array.from(changedFiles),
  };
}

/**
 * Format a sub-agent summary as a human-readable string for LLM context injection.
 */
export function formatSubAgentSummary(summary: SubAgentSummary): string {
  const lines: string[] = [
    `## Sub-Agent Summary`,
    `- Total: ${summary.totalAgents} | Succeeded: ${summary.succeeded} | Failed: ${summary.failed}`,
    `- Total tokens: ${summary.totalTokens.toLocaleString()}`,
    `- Changed files: ${summary.changedFiles.length}`,
  ];

  if (summary.changedFiles.length > 0) {
    lines.push(`- Files: ${summary.changedFiles.join(', ')}`);
  }

  if (summary.conflicts.length > 0) {
    lines.push(`\n### Conflicts Detected`);
    for (const conflict of summary.conflicts) {
      lines.push(`- \`${conflict.file}\`: modified by ${conflict.agents.join(', ')}`);
    }
  }

  return lines.join('\n');
}
