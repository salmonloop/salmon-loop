import { FileAdapter } from '../adapters/fs/index.js';
import { getLogger } from '../observability/logger.js';

import { SessionCompressor } from './compression.js';
import type { ChatSession } from './types.js';

/**
 * Session importance scoring strategy
 */
export interface MemoryPruningStrategy {
  maxAgeDays: number;
  maxSessions: number;
  importanceScoring: (session: ChatSession) => number;
  autoPrune: boolean;
  gracePeriodDays: number;
  lowScoreThreshold: number;
}

/**
 * Default memory pruning strategy configuration
 */
export const DEFAULT_PRUNING_STRATEGY: MemoryPruningStrategy = {
  maxAgeDays: 30,
  maxSessions: 50,
  autoPrune: true,
  gracePeriodDays: 7,
  importanceScoring: calculateDefaultImportanceScore,
  lowScoreThreshold: 10,
};

/**
 * Session pruning result
 */
export interface PruningResult {
  sessionsToDelete: string[];
  sessionsToArchive: string[];
  sessionsToKeep: string[];
  summary: {
    totalSessions: number;
    deletedCount: number;
    archivedCount: number;
    keptCount: number;
  };
}

/**
 * Default importance scoring algorithm
 */
export function calculateDefaultImportanceScore(session: ChatSession): number {
  let score = 0;

  // Score based on successful iterations
  score += session.meta.successfulIterations * 8;

  // Score based on snapshot count
  score += session.meta.snapshots.length * 3;

  // Score based on recent activity (time decay)
  const daysSinceUpdate = (Date.now() - session.meta.updatedAt) / (1000 * 60 * 60 * 24);
  const recencyScore = Math.max(0, 12 - daysSinceUpdate);
  score += recencyScore;

  // Score based on message count
  score += Math.min(session.messages.length * 0.5, 10);

  // Score based on token usage
  const totalTokens = session.meta.totalTokens.input + session.meta.totalTokens.output;
  score += Math.min(totalTokens / 2000, 10); // Reduced token weight

  return Math.round(score * 100) / 100; // Keep two decimal places
}

/**
 * Session pruning engine
 */
export class SessionPruningEngine {
  private strategy: MemoryPruningStrategy;

  constructor(strategy: Partial<MemoryPruningStrategy> = {}) {
    this.strategy = { ...DEFAULT_PRUNING_STRATEGY, ...strategy };
  }

  /**
   * Analyze sessions and determine pruning strategy
   */
  analyzeSessions(sessions: ChatSession[]): PruningResult {
    const now = Date.now();
    const sessionsWithScores = sessions.map((session) => ({
      session,
      score: this.strategy.importanceScoring(session),
      ageInDays: (now - session.meta.createdAt) / (1000 * 60 * 60 * 24),
    }));

    // Sort by importance score descending
    sessionsWithScores.sort((a, b) => b.score - a.score);

    const result: PruningResult = {
      sessionsToDelete: [],
      sessionsToArchive: [],
      sessionsToKeep: [],
      summary: {
        totalSessions: sessions.length,
        deletedCount: 0,
        archivedCount: 0,
        keptCount: 0,
      },
    };

    for (const { session, score, ageInDays } of sessionsWithScores) {
      const isExpired = ageInDays > this.strategy.maxAgeDays;
      const isInGracePeriod = ageInDays <= this.strategy.maxAgeDays + this.strategy.gracePeriodDays;
      const hasLowScore = score < this.strategy.lowScoreThreshold;

      if (isExpired && hasLowScore && !isInGracePeriod) {
        // Expired and low importance sessions to delete directly
        result.sessionsToDelete.push(session.meta.id);
      } else if (isExpired && hasLowScore) {
        // Low importance sessions within grace period to archive
        result.sessionsToArchive.push(session.meta.id);
      } else {
        // Important sessions or unexpired sessions to keep
        result.sessionsToKeep.push(session.meta.id);
      }
    }

    // If sessions to keep exceed maximum limit, archive excess sessions
    if (result.sessionsToKeep.length > this.strategy.maxSessions) {
      const excessSessions = result.sessionsToKeep.slice(this.strategy.maxSessions);
      result.sessionsToKeep = result.sessionsToKeep.slice(0, this.strategy.maxSessions);
      result.sessionsToArchive.push(...excessSessions);
    }

    // Update statistics
    result.summary.deletedCount = result.sessionsToDelete.length;
    result.summary.archivedCount = result.sessionsToArchive.length;
    result.summary.keptCount = result.sessionsToKeep.length;

    return result;
  }

  /**
   * Get session importance score
   */
  getSessionScore(session: ChatSession): number {
    return this.strategy.importanceScoring(session);
  }

  /**
   * Update strategy configuration
   */
  updateStrategy(newStrategy: Partial<MemoryPruningStrategy>): void {
    this.strategy = { ...this.strategy, ...newStrategy };
  }

  /**
   * Get current strategy configuration
   */
  getStrategy(): MemoryPruningStrategy {
    return { ...this.strategy };
  }
}

/**
 * Session archiver
 */
export class SessionArchiver {
  private archiveDir: string;
  private baseDir: string;
  private fileAdapter: FileAdapter;
  private compressor: SessionCompressor;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
    this.archiveDir = `${baseDir}/.salmonloop/chat-archives`;
    this.fileAdapter = new FileAdapter();
    this.compressor = new SessionCompressor();
  }

  /**
   * Create session archive
   */
  async createArchive(session: ChatSession, compressedData: Uint8Array): Promise<string> {
    const archiveId = `${session.meta.id}-${Date.now()}`;
    const archivePath = `${this.archiveDir}/${archiveId}.mpack.gz`;

    // Ensure archive directory exists
    await this.ensureArchiveDir();

    // Write compressed data
    await this.writeCompressedData(archivePath, compressedData);

    return archiveId;
  }

  /**
   * Restore session from archive
   */
  async restoreFromArchive(archiveId: string): Promise<ChatSession | null> {
    try {
      const archiveFile = archiveId.endsWith('.mpack.gz') ? archiveId : `${archiveId}.mpack.gz`;
      const archivePath = `${this.archiveDir}/${archiveFile}`;
      const encoded = await this.fileAdapter.readFile(archivePath);
      const binary = new Uint8Array(Buffer.from(encoded, 'base64'));

      const compressed = await this.compressor.decompressFromBinary(binary);
      const partial = await this.compressor.decompressToSession(compressed);

      return {
        meta: {
          id: partial.meta.id,
          name: partial.meta.name,
          repoPath: this.baseDir,
          createdAt: partial.meta.createdAt,
          updatedAt: Date.now(),
          totalIterations: partial.meta.totalIterations ?? partial.iterations.length,
          successfulIterations: partial.meta.successfulIterations ?? 0,
          totalTokens: partial.meta.totalTokens ?? { input: 0, output: 0 },
          snapshots: [],
        },
        messages: partial.messages.map((message, index) => ({
          id: `archived-msg-${index}`,
          role: message.role,
          content: message.content,
          timestamp: message.timestamp,
        })),
        iterations: partial.iterations.map((iter, index) => ({
          id: iter.id || `archived-iter-${index + 1}`,
          attempt: index + 1,
          plan: null,
          patch: null,
          error: iter.outcome === 'failure' ? iter.summary : undefined,
          contextSummary: iter.summary,
        })),
      };
    } catch {
      return null;
    }
  }

  private async ensureArchiveDir(): Promise<void> {
    await this.fileAdapter.mkdir(this.archiveDir);
  }

  private async writeCompressedData(
    archivePath: string,
    compressedData: Uint8Array,
  ): Promise<void> {
    const encoded = Buffer.from(compressedData).toString('base64');
    try {
      await this.fileAdapter.writeFile(archivePath, encoded);
    } catch (error) {
      getLogger().warn(`Failed to write session archive ${archivePath}: ${error}`);
      throw error;
    }
  }
}
