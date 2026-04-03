import { randomBytes } from 'crypto';
import { join } from 'path';

import { FileAdapter } from '../adapters/fs/index.js';
import { recordAuditEvent } from '../observability/audit-trail.js';
import { getLogger } from '../observability/logger.js';
import type { LoopIteration } from '../types/index.js';

import {
  mergeReplacementStateFromArtifactHints,
  mergeSessionArtifactState,
  normalizeSessionArtifactState,
  type SessionArtifactState,
} from './artifact-state.js';
import { SessionCompressor, CompressedSessionStore } from './compression.js';
import { SessionPruningEngine, type MemoryPruningStrategy } from './pruning-strategy.js';
import {
  freezeToolResultReplacementDecision,
  normalizeToolResultReplacementState,
  type ToolResultReplacementState,
} from './replacement-state.js';
import { createResumeRepairPipeline } from './resume-repair/pipeline.js';
import type { ChatSession, ChatMessage, SummaryState } from './types.js';

const RESUME_REPAIR_V1_FLAG = 'SALMONLOOP_RESUME_REPAIR_V1';

function resolveResumeRepairV1Enabled(): boolean {
  const raw = process.env[RESUME_REPAIR_V1_FLAG];
  if (!raw || !raw.trim()) return true;
  const normalized = raw.trim().toLowerCase();
  if (normalized === '0' || normalized === 'false' || normalized === 'off' || normalized === 'no') {
    return false;
  }
  return true;
}

function recordResumeRepairMetrics(details: {
  mode: 'repair_v1' | 'legacy';
  success: boolean;
  repairViolationCount: number;
  replacementReuseHitCount: number;
  contractViolationCodes?: string[];
}): void {
  recordAuditEvent(
    'session.resume_repair.completed',
    {
      mode: details.mode,
      success: details.success,
      metric: 'repair_violation_rate',
      repairViolationCount: details.repairViolationCount,
      replacementReuseMetric: 'replacement_reuse_hit_rate',
      replacementReuseHitCount: details.replacementReuseHitCount,
      contractViolationCodes: details.contractViolationCodes ?? [],
    },
    {
      source: 'session',
      severity: details.success ? 'low' : 'medium',
      scope: 'session',
    },
  );
}

/**
 * Manages chat session persistence and lifecycle.
 * Storage: .salmonloop/chat-sessions/<id>.json
 * Features: Auto-pruning, compression, intelligent cleanup
 */
export class ChatSessionManager {
  private repoPath: string;
  private storageDir: string;
  private currentSession: ChatSession | null = null;
  private fileAdapter = new FileAdapter();
  private pruningEngine: SessionPruningEngine;
  private compressor: SessionCompressor;
  private compressedStore: CompressedSessionStore;

  constructor(repoPath: string, pruningStrategy?: Partial<MemoryPruningStrategy>) {
    this.repoPath = repoPath;
    this.storageDir = join(repoPath, '.salmonloop', 'chat-sessions');
    this.pruningEngine = new SessionPruningEngine(pruningStrategy);
    this.compressor = new SessionCompressor();
    this.compressedStore = new CompressedSessionStore(repoPath);
  }

  /**
   * Initialize storage directory
   */
  async init(): Promise<void> {
    await this.fileAdapter.mkdir(this.storageDir);
  }

  /**
   * Create new chat session
   */
  async create(name?: string): Promise<ChatSession> {
    const id = randomBytes(8).toString('hex');
    const now = Date.now();

    const session: ChatSession = {
      meta: {
        id,
        name: name || `Chat ${new Date().toLocaleString()}`,
        repoPath: this.storageDir.replace(/\.salmonloop.*/, ''),
        createdAt: now,
        updatedAt: now,
        totalIterations: 0,
        successfulIterations: 0,
        totalTokens: { input: 0, output: 0 },
        snapshots: [],
      },
      messages: [],
      iterations: [],
    };

    this.currentSession = session;
    await this.save();
    return session;
  }

  /**
   * Load most recent session (by modification time)
   */
  async loadLast(): Promise<ChatSession | null> {
    const files = await this.fileAdapter.readdir(this.storageDir).catch(() => []);
    const jsonFiles = files.filter((f) => f.endsWith('.json'));

    if (jsonFiles.length === 0) return null;

    // Sort by modification time (descending)
    const fileStats = await Promise.all(
      jsonFiles.map(async (f) => {
        const filePath = join(this.storageDir, f);
        const stats = await this.fileAdapter.stat(filePath);
        return { name: f, mtime: stats.mtime.getTime() };
      }),
    );

    fileStats.sort((a, b) => b.mtime - a.mtime);
    const latestFile = fileStats[0].name;

    return this.load(latestFile.replace('.json', ''));
  }

  /**
   * Load session by ID (supports short ID prefix)
   */
  async load(id: string): Promise<ChatSession | null> {
    let targetId = id;

    // Support short ID matching
    if (id.length < 16) {
      const files = await this.fileAdapter.readdir(this.storageDir).catch(() => []);
      const match = files.find((f) => f.startsWith(id) && f.endsWith('.json'));
      if (match) {
        targetId = match.replace('.json', '');
      }
    }

    const filePath = join(this.storageDir, `${targetId}.json`);
    try {
      const data = await this.fileAdapter.readFile(filePath);
      const parsed = JSON.parse(data) as ChatSession;
      parsed.meta.artifactState = normalizeSessionArtifactState(parsed.meta.artifactState);
      parsed.meta.replacementState = normalizeToolResultReplacementState(
        parsed.meta.replacementState,
      );
      this.currentSession = parsed;
      return this.currentSession;
    } catch {
      return null;
    }
  }

  /**
   * Resume a session (alias for load, with explicit name)
   */
  async resumeSession(id: string): Promise<ChatSession> {
    const session = await this.load(id);
    if (!session) {
      throw new Error(`Session ${id} not found`);
    }
    return session;
  }

  /**
   * Save current session to disk
   */
  async save(): Promise<void> {
    if (!this.currentSession) return;

    this.currentSession.meta.updatedAt = Date.now();
    const filePath = join(this.storageDir, `${this.currentSession.meta.id}.json`);
    await this.fileAdapter.writeFile(filePath, JSON.stringify(this.currentSession, null, 2));
  }

  /**
   * Add message to current session
   */
  addMessage(message: ChatMessage): void {
    if (!this.currentSession) throw new Error('No active session');
    this.currentSession.messages.push(message);
  }

  /**
   * Add execution iteration to current session
   */
  addIteration(iteration: LoopIteration, snapshotHash?: string): string {
    if (!this.currentSession) throw new Error('No active session');

    const id = randomBytes(4).toString('hex');
    this.currentSession.iterations.push({ ...iteration, id });
    this.currentSession.meta.totalIterations++;

    if (snapshotHash) {
      this.currentSession.meta.snapshots.push({
        id: snapshotHash,
        iterationId: id,
        timestamp: Date.now(),
      });
    }

    return id;
  }

  /**
   * Get conversation history (for LLM context)
   */
  getMessages(): ChatMessage[] {
    return this.currentSession?.messages || [];
  }

  /**
   * Get messages with IDs for summarization.
   * Ensures all messages have IDs.
   */
  getMessagesWithIds(): Array<ChatMessage & { id: string }> {
    const messages = this.currentSession?.messages || [];
    return messages.map((m, i) => ({
      ...m,
      id: m.id || `msg-${i}-${m.timestamp}`,
    }));
  }

  /**
   * Get current session (throws if none)
   */
  getCurrent(): ChatSession {
    if (!this.currentSession) throw new Error('No active session');
    return this.currentSession;
  }

  /**
   * Get summary state for summarization.
   */
  getSummaryState(): SummaryState | undefined {
    return this.currentSession?.meta.summaryState;
  }

  getArtifactState(): SessionArtifactState | undefined {
    return normalizeSessionArtifactState(this.currentSession?.meta.artifactState);
  }

  /**
   * Update summary state after summarization.
   */
  updateSummaryState(state: SummaryState): void {
    if (!this.currentSession) throw new Error('No active session');
    this.currentSession.meta.summaryState = state;
  }

  updateArtifactState(state: SessionArtifactState | undefined): void {
    if (!this.currentSession) throw new Error('No active session');
    this.currentSession.meta.artifactState = normalizeSessionArtifactState(state);
  }

  mergeArtifactState(state: SessionArtifactState | undefined): void {
    if (!this.currentSession) throw new Error('No active session');
    this.currentSession.meta.artifactState = mergeSessionArtifactState(
      this.currentSession.meta.artifactState,
      state,
    );
    this.currentSession.meta.replacementState = mergeReplacementStateFromArtifactHints(
      this.currentSession.meta.replacementState,
      state,
    );
  }

  getReplacementState(): ToolResultReplacementState | undefined {
    return normalizeToolResultReplacementState(this.currentSession?.meta.replacementState);
  }

  updateReplacementState(state: ToolResultReplacementState | undefined): void {
    if (!this.currentSession) throw new Error('No active session');
    this.currentSession.meta.replacementState = normalizeToolResultReplacementState(state);
  }

  freezeReplacementDecision(
    entry: Parameters<typeof freezeToolResultReplacementDecision>[1],
    options?: Parameters<typeof freezeToolResultReplacementDecision>[2],
  ): void {
    if (!this.currentSession) throw new Error('No active session');
    this.currentSession.meta.replacementState = freezeToolResultReplacementDecision(
      this.currentSession.meta.replacementState,
      entry,
      options,
    );
  }

  /**
   * Clear summary state (e.g., on session reset).
   */
  clearSummaryState(): void {
    if (!this.currentSession) return;
    this.currentSession.meta.summaryState = undefined;
  }

  /**
   * List all sessions (sorted by update time)
   */
  async listSessions(): Promise<Array<{ id: string; name: string; updatedAt: number }>> {
    const files = await this.fileAdapter.readdir(this.storageDir).catch(() => []);
    const sessions = [];

    for (const file of files) {
      if (!file.endsWith('.json')) continue;

      const filePath = join(this.storageDir, file);
      const data = await this.fileAdapter.readFile(filePath);
      const session = JSON.parse(data) as ChatSession;

      sessions.push({
        id: session.meta.id,
        name: session.meta.name,
        updatedAt: session.meta.updatedAt,
      });
    }

    return sessions.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /**
   * Perform automatic session cleanup based on pruning strategy
   */
  async performAutoCleanup(): Promise<{
    deleted: number;
    archived: number;
    kept: number;
  }> {
    const sessions = await this.loadAllSessions();
    const analysis = this.pruningEngine.analyzeSessions(sessions);

    let deleted = 0;
    let archived = 0;

    // Delete low-priority sessions
    for (const sessionId of analysis.sessionsToDelete) {
      await this.deleteSession(sessionId);
      deleted++;
    }

    // Archive medium-priority sessions
    for (const sessionId of analysis.sessionsToArchive) {
      const session = sessions.find((s) => s.meta.id === sessionId);
      if (session) {
        await this.archiveSession(session);
        await this.deleteSession(sessionId);
        archived++;
      }
    }

    return {
      deleted,
      archived,
      kept: analysis.sessionsToKeep.length,
    };
  }

  /**
   * Archive a session with compression
   */
  async archiveSession(session: ChatSession): Promise<string> {
    const importanceScore = this.pruningEngine.getSessionScore(session);
    return await this.compressedStore.saveCompressed(session, importanceScore);
  }

  /**
   * Load all sessions from storage
   */
  private async loadAllSessions(): Promise<ChatSession[]> {
    const files = await this.fileAdapter.readdir(this.storageDir).catch(() => []);
    const sessions: ChatSession[] = [];

    for (const file of files) {
      if (!file.endsWith('.json')) continue;

      try {
        const filePath = join(this.storageDir, file);
        const data = await this.fileAdapter.readFile(filePath);
        const session = JSON.parse(data) as ChatSession;
        session.meta.artifactState = normalizeSessionArtifactState(session.meta.artifactState);
        session.meta.replacementState = normalizeToolResultReplacementState(
          session.meta.replacementState,
        );
        sessions.push(session);
      } catch (error) {
        // Skip corrupted session files
        getLogger().warn(`Failed to load session file ${file}: ${error}`);
      }
    }

    return sessions;
  }

  /**
   * Delete a session file
   */
  private async deleteSession(sessionId: string): Promise<void> {
    const filePath = join(this.storageDir, `${sessionId}.json`);
    try {
      await this.fileAdapter.deleteFile(filePath);
    } catch (error) {
      getLogger().warn(`Failed to delete session ${sessionId}: ${error}`);
    }
  }

  /**
   * Get session importance score
   */
  getSessionScore(session: ChatSession): number {
    return this.pruningEngine.getSessionScore(session);
  }

  /**
   * Update pruning strategy
   */
  updatePruningStrategy(strategy: Partial<MemoryPruningStrategy>): void {
    this.pruningEngine.updateStrategy(strategy);
  }

  /**
   * Get current pruning strategy
   */
  getPruningStrategy(): MemoryPruningStrategy {
    return this.pruningEngine.getStrategy();
  }

  /**
   * List archived sessions
   */
  async listArchivedSessions(): Promise<Array<{ id: string; name: string; archivedAt: number }>> {
    const archiveDir = this.getArchiveStorageDir();
    const files = await this.fileAdapter.readdir(archiveDir).catch(() => []);
    const archived: Array<{ id: string; name: string; archivedAt: number }> = [];

    for (const file of files) {
      if (!file.endsWith('.mpack.gz')) continue;
      try {
        const compressed = await this.compressedStore.loadCompressed(file);
        if (!compressed) continue;

        const stats = await this.fileAdapter.stat(join(archiveDir, file));
        archived.push({
          id: compressed.meta.id,
          name: compressed.meta.name,
          archivedAt: stats.mtime.getTime(),
        });
      } catch (error) {
        getLogger().warn(`Failed to load archived session ${file}: ${error}`);
      }
    }

    return archived.sort((a, b) => b.archivedAt - a.archivedAt);
  }

  /**
   * Restore session from archive
   */
  async restoreFromArchive(archiveId: string): Promise<ChatSession | null> {
    const filename = await this.resolveArchiveFilename(archiveId);
    if (!filename) return null;

    const resumeRepairV1Enabled = resolveResumeRepairV1Enabled();
    try {
      if (!resumeRepairV1Enabled) {
        const restored = await this.restoreFromArchiveLegacy(filename);
        if (!restored) {
          recordResumeRepairMetrics({
            mode: 'legacy',
            success: false,
            repairViolationCount: 1,
            replacementReuseHitCount: 0,
            contractViolationCodes: ['LEGACY_RESTORE_FAILED'],
          });
          return null;
        }
        recordResumeRepairMetrics({
          mode: 'legacy',
          success: true,
          repairViolationCount: 0,
          replacementReuseHitCount: Object.keys(restored.meta.replacementState?.entries ?? {}).length,
        });
        this.currentSession = restored;
        await this.save();
        return restored;
      }

      const pipeline = createResumeRepairPipeline({
        compressedStore: this.compressedStore,
        compressor: this.compressor,
        repoPath: this.repoPath,
      });
      const repaired = await pipeline.run({ archiveId, filename });
      if (!repaired.session) {
        recordResumeRepairMetrics({
          mode: 'repair_v1',
          success: false,
          repairViolationCount: repaired.contractViolations.length,
          replacementReuseHitCount: 0,
          contractViolationCodes: repaired.contractViolations.map((entry) => entry.code),
        });
        const violationText = repaired.contractViolations.map((entry) => entry.message).join('; ');
        getLogger().warn(
          `Failed to restore archived session ${archiveId}: ${violationText || 'repair pipeline rejected archive'}`,
        );
        return null;
      }

      repaired.session.meta.resumeRepairState = {
        schemaVersion: 1,
        lastRunAt: Date.now(),
        warnings: repaired.warnings.map((entry) => `${entry.code}: ${entry.message}`),
        repairActions: repaired.repairActions.map((entry) => `${entry.code}: ${entry.detail}`),
        contractViolations: repaired.contractViolations.map(
          (entry) => `${entry.code}: ${entry.message}`,
        ),
      };
      repaired.session.meta.replacementState = normalizeToolResultReplacementState(
        repaired.replacementState,
      );
      recordResumeRepairMetrics({
        mode: 'repair_v1',
        success: true,
        repairViolationCount: repaired.contractViolations.length,
        replacementReuseHitCount: Object.keys(repaired.replacementState?.entries ?? {}).length,
        contractViolationCodes: repaired.contractViolations.map((entry) => entry.code),
      });

      this.currentSession = repaired.session;
      await this.save();
      return repaired.session;
    } catch (error) {
      recordResumeRepairMetrics({
        mode: resumeRepairV1Enabled ? 'repair_v1' : 'legacy',
        success: false,
        repairViolationCount: 1,
        replacementReuseHitCount: 0,
        contractViolationCodes: ['RESTORE_EXCEPTION'],
      });
      getLogger().warn(`Failed to restore archived session ${archiveId}: ${error}`);
      return null;
    }
  }

  private async restoreFromArchiveLegacy(filename: string): Promise<ChatSession | null> {
    const compressed = await this.compressedStore.loadCompressed(filename);
    if (!compressed) return null;

    const partial = await this.compressor.decompressToSession(compressed);
    if (!partial?.meta?.id || !partial?.meta?.name) return null;

    return {
      meta: {
        id: partial.meta.id,
        name: partial.meta.name,
        repoPath: this.repoPath,
        createdAt: partial.meta.createdAt,
        updatedAt: Date.now(),
        totalIterations: partial.meta.totalIterations ?? partial.iterations.length,
        successfulIterations: partial.meta.successfulIterations ?? 0,
        totalTokens: partial.meta.totalTokens ?? { input: 0, output: 0 },
        snapshots: [],
        artifactState: normalizeSessionArtifactState(partial.meta.artifactState),
        replacementState: normalizeToolResultReplacementState(partial.meta.replacementState),
      },
      messages: partial.messages.map((message, index) => ({
        id: `restored-msg-${index}`,
        role: message.role,
        content: message.content,
        timestamp: message.timestamp,
      })),
      iterations: partial.iterations.map((iteration, index) => ({
        id: iteration.id || `restored-iter-${index + 1}`,
        attempt: index + 1,
        plan: null,
        patch: null,
        error: iteration.outcome === 'failure' ? iteration.summary : undefined,
        contextSummary: iteration.summary,
      })),
    };
  }

  private getArchiveStorageDir(): string {
    return join(this.repoPath, '.salmonloop', 'compressed-sessions');
  }

  private async resolveArchiveFilename(archiveId: string): Promise<string | null> {
    const archiveDir = this.getArchiveStorageDir();
    const files = (await this.fileAdapter.readdir(archiveDir).catch(() => [])).filter((file) =>
      file.endsWith('.mpack.gz'),
    );
    if (files.length === 0) return null;

    if (archiveId.endsWith('.mpack.gz') && files.includes(archiveId)) {
      return archiveId;
    }

    const exactFilename = `${archiveId}.mpack.gz`;
    if (files.includes(exactFilename)) {
      return exactFilename;
    }

    const prefixMatches = files.filter((file) => file.startsWith(archiveId));
    if (prefixMatches.length === 0) return null;
    if (prefixMatches.length === 1) return prefixMatches[0];

    const withMtime = await Promise.all(
      prefixMatches.map(async (file) => {
        const stats = await this.fileAdapter.stat(join(archiveDir, file));
        return { file, mtime: stats.mtime.getTime() };
      }),
    );
    withMtime.sort((a, b) => b.mtime - a.mtime);
    return withMtime[0]?.file ?? null;
  }
}
