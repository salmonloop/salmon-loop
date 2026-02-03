import { randomBytes } from 'crypto';
import { join } from 'path';

import { FileAdapter } from '../adapters/fs/file-adapter.js';
import type { LoopIteration } from '../types.js';

import type { ChatSession, ChatMessage } from './types.js';

/**
 * Manages chat session persistence and lifecycle.
 * Storage: .salmonloop/chat-sessions/<id>.json
 */
export class ChatSessionManager {
  private storageDir: string;
  private currentSession: ChatSession | null = null;
  private fileAdapter = new FileAdapter();

  constructor(repoPath: string) {
    this.storageDir = join(repoPath, '.salmonloop', 'chat-sessions');
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
   * Get current session (throws if none)
   */
  getCurrent(): ChatSession {
    if (!this.currentSession) throw new Error('No active session');
    return this.currentSession;
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
}
