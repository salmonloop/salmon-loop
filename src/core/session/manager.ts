import { randomBytes } from 'crypto';
import { join } from 'path';

import { FileAdapter } from '../adapters/fs/index.js';
import { getLogger } from '../observability/logger.js';
import type { LoopIteration } from '../types/index.js';

import { SessionCompressor, CompressedSessionStore } from './compression.js';
import { SessionPruningEngine, type MemoryPruningStrategy } from './pruning-strategy.js';
import type { ChatSession, ChatMessage, SummaryState } from './types.js';

/**
 * Manages chat session persistence and lifecycle.
 * Storage: .salmonloop/chat-sessions/<id>.json
 * Features: Auto-pruning, compression, intelligent cleanup
 */
export class ChatSessionManager {
  private storageDir: string;
  private currentSession: ChatSession | null = null;
  private fileAdapter = new FileAdapter();
  private pruningEngine: SessionPruningEngine;
  private compressor: SessionCompressor;
  private compressedStore: CompressedSessionStore;

  constructor(repoPath: string, pruningStrategy?: Partial<MemoryPruningStrategy>) {
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
      this.currentSession = JSON.parse(data);
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

  /**
   * Update summary state after summarization.
   */
  updateSummaryState(state: SummaryState): void {
    if (!this.currentSession) throw new Error('No active session');
    this.currentSession.meta.summaryState = state;
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
    // Implement archived session list functionality
    // This needs to access the compressed storage
    return [];
  }

  /**
   * Restore session from archive
   */
  async restoreFromArchive(_archiveId: string): Promise<ChatSession | null> {
    // Implement session restoration from archive functionality
    // This needs to access the compressed storage and decompress
    return null;
  }
}
