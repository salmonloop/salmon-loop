export type UnifiedDiff = string;

export interface CandidatePatch {
  agentId: string;
  rationale: string;
  patch: UnifiedDiff;
  touchedPaths: string[];
  confidence: number;
}

export interface AggregatedPatch {
  mergedPatch: UnifiedDiff;
  touchedPaths: string[];
  conflicts: Array<{ path: string; reason: string; agents: string[] }>;
}

interface Hunk {
  header: string;
  oldStart: number;
  oldLen: number;
  newStart: number;
  newLen: number;
  lines: string[];
}

export class PatchAggregator {
  /**
   * Aggregates multiple candidate patches into a single patch using hunk-level merging.
   *
   * Strategy:
   * 1. Parse unified diffs into atomic Hunks.
   * 2. Perform line range collision detection: [start, start + len).
   * 3. Safely merge non-overlapping hunks even within the same file.
   * 4. Report conflicts only when line ranges actually overlap.
   */
  static aggregate(candidates: CandidatePatch[]): AggregatedPatch {
    const fileHunksMap = new Map<string, { hunks: Hunk[]; agents: string[] }>();
    const touchedPaths = new Set<string>();

    for (const candidate of candidates) {
      for (const path of candidate.touchedPaths) {
        touchedPaths.add(path);
        if (!fileHunksMap.has(path)) {
          fileHunksMap.set(path, { hunks: [], agents: [] });
        }

        const entry = fileHunksMap.get(path)!;
        if (!entry.agents.includes(candidate.agentId)) {
          entry.agents.push(candidate.agentId);
        }

        const parsedHunks = this.parseHunks(candidate.patch);
        entry.hunks.push(...parsedHunks);
      }
    }

    const conflicts: AggregatedPatch['conflicts'] = [];
    let mergedPatch = '';

    for (const [path, entry] of fileHunksMap) {
      // Sort hunks by starting line to ensure stable output and easier collision check
      const sortedHunks = [...entry.hunks].sort((a, b) => a.oldStart - b.oldStart);
      const mergedFileHunks: Hunk[] = [];
      let fileConflict = false;

      for (const hunk of sortedHunks) {
        // Collision detection: Check if this hunk overlaps with any already accepted hunk
        const collision = mergedFileHunks.find(
          (existing) =>
            Math.max(existing.oldStart, hunk.oldStart) <
            Math.min(existing.oldStart + existing.oldLen, hunk.oldStart + hunk.oldLen),
        );

        if (collision) {
          conflicts.push({
            path,
            reason: `Hunk collision detected at line ${hunk.oldStart}. Multiple agents modified overlapping ranges.`,
            agents: entry.agents,
          });
          fileConflict = true;
          break;
        }
        mergedFileHunks.push(hunk);
      }

      if (!fileConflict && mergedFileHunks.length > 0) {
        // Construct the aggregated patch for this file
        mergedPatch += `--- a/${path}\n+++ b/${path}\n`;
        mergedPatch += mergedFileHunks.map((h) => h.lines.join('\n')).join('\n') + '\n';
      }
    }

    return {
      mergedPatch,
      touchedPaths: Array.from(touchedPaths),
      conflicts,
    };
  }

  private static parseHunks(diff: string): Hunk[] {
    const hunks: Hunk[] = [];
    const lines = diff.split('\n');
    let currentHunk: Hunk | null = null;

    for (const line of lines) {
      // Unified diff hunk header: @@ -oldStart,oldLen +newStart,newLen @@
      const match = line.match(/^@@ -(\d+),?(\d*) \+(\d+),?(\d*) @@/);
      if (match) {
        if (currentHunk) hunks.push(currentHunk);
        currentHunk = {
          header: line,
          oldStart: parseInt(match[1]),
          oldLen: parseInt(match[2] || '1'),
          newStart: parseInt(match[3]),
          newLen: parseInt(match[4] || '1'),
          lines: [line],
        };
      } else if (currentHunk) {
        // Skip file headers (--- / +++) and only collect lines belonging to the hunk
        if (!line.startsWith('---') && !line.startsWith('+++')) {
          currentHunk.lines.push(line);
        }
      }
    }
    if (currentHunk) hunks.push(currentHunk);
    return hunks;
  }
}
