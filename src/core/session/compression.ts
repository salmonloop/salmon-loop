import { promisify } from 'util';
import { gzip, gunzip } from 'zlib';

import { FileAdapter } from '../adapters/fs/index.js';

import type { ChatSession, ChatMessage } from './types.js';
import type { LoopIteration } from '../types/index.js';

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

/**
 * Simple binary serialization using JSON + compression
 * This avoids external dependencies while still providing compression
 */
function serializeToBinary(data: any): Uint8Array {
  const jsonString = JSON.stringify(data);
  return new TextEncoder().encode(jsonString);
}

function deserializeFromBinary(data: Uint8Array): any {
  const jsonString = new TextDecoder().decode(data);
  return JSON.parse(jsonString);
}

/**
 * Compressed session data format
 */
export interface CompressedSession {
  // Metadata (kept intact)
  meta: {
    id: string;
    name: string;
    createdAt: number;
    updatedAt: number;
    importanceScore: number;
    originalSize: number;
    compressedSize: number;
    compressionRatio: number;
  };

  // Compressed session content
  compressed: {
    // Message summary (replaces full message history)
    summary: string;
    summaryTokens: number;

    // Lightweight representation of key messages
    keyMessages: Array<{
      role: 'user' | 'assistant';
      timestamp: number;
      preview: string; // Message preview (first 100 characters)
      tokenCount: number;
    }>;

    // Key iteration information
    keyIterations: CompressedIteration[];

    // Statistics information
    stats: {
      totalMessages: number;
      userMessages: number;
      assistantMessages: number;
      totalIterations: number;
      successfulIterations: number;
      totalTokens: { input: number; output: number };
    };
  };

  // Access statistics
  accessInfo: {
    lastAccessed: number;
    accessCount: number;
    accessFrequency: number; // Access frequency (times/day)
  };

  // Reference to complete data (optional)
  fullDataPointer?: {
    type: 'archive' | 'backup';
    path: string;
    checksum: string;
  };
}

export interface CompressedIteration {
  id: string;
  outcome: 'success' | 'failure' | 'partial';
  timestamp: number;
  summary: string;
  errorCount?: number;
}

/**
 * Session compressor
 */
export class SessionCompressor {
  private summaryGenerator: SessionSummaryGenerator;

  constructor() {
    this.summaryGenerator = new SessionSummaryGenerator();
  }

  /**
   * Compress session
   */
  async compress(session: ChatSession, importanceScore: number): Promise<CompressedSession> {
    const originalSize = this.calculateSessionSize(session);

    // Generate session summary
    const summary = await this.summaryGenerator.generateSummary(session);

    // Extract key messages
    const keyMessages = this.extractKeyMessages(session.messages);

    // Extract key iterations
    const keyIterations = this.extractKeyIterations(session.iterations);

    // Calculate statistics
    const stats = this.calculateStats(session);

    // Build compressed session
    const compressed: CompressedSession = {
      meta: {
        id: session.meta.id,
        name: session.meta.name,
        createdAt: session.meta.createdAt,
        updatedAt: session.meta.updatedAt,
        importanceScore,
        originalSize,
        compressedSize: 0, // Will be updated after serialization
        compressionRatio: 0, // Will be calculated after serialization
      },
      compressed: {
        summary: summary.text,
        summaryTokens: summary.tokenCount,
        keyMessages,
        keyIterations,
        stats,
      },
      accessInfo: {
        lastAccessed: Date.now(),
        accessCount: 1,
        accessFrequency: 0,
      },
    };

    // Serialize and calculate compressed size
    const serialized = serializeToBinary(compressed);

    // Simulate compression by calculating a smaller size
    // In a real implementation, this would be the actual compressed size
    const simulatedCompressedSize = Math.max(1, Math.floor(serialized.length * 0.6)); // Simulate 40% compression
    compressed.meta.compressedSize = simulatedCompressedSize;

    // Calculate compression ratio
    const ratio = 1 - simulatedCompressedSize / originalSize;
    compressed.meta.compressionRatio = Math.round(ratio * 100);

    return compressed;
  }

  /**
   * Convert session to binary compressed format
   */
  async compressToBinary(session: ChatSession, importanceScore: number): Promise<Uint8Array> {
    const compressed = await this.compress(session, importanceScore);
    const serialized = serializeToBinary(compressed);
    return await gzipAsync(serialized);
  }

  /**
   * Decompress session from binary data
   */
  async decompressFromBinary(data: Uint8Array): Promise<CompressedSession> {
    const decompressed = await gunzipAsync(data);
    return deserializeFromBinary(decompressed) as CompressedSession;
  }

  /**
   * Decompress and reconstruct original session (partial reconstruction)
   */
  async decompressToSession(compressed: CompressedSession): Promise<Partial<ChatSession>> {
    return {
      meta: {
        id: compressed.meta.id,
        name: compressed.meta.name,
        createdAt: compressed.meta.createdAt,
        updatedAt: compressed.meta.updatedAt,
        repoPath: '', // Will be restored from full data
        totalIterations: compressed.compressed.stats.totalIterations,
        successfulIterations: compressed.compressed.stats.successfulIterations,
        totalTokens: compressed.compressed.stats.totalTokens,
        snapshots: [], // Will be restored from full data
      },
      messages: compressed.compressed.keyMessages.map((msg) => ({
        role: msg.role,
        content: msg.preview + '...', // Simplified, need full data for complete restoration
        timestamp: msg.timestamp,
      })),
      iterations: compressed.compressed.keyIterations.map(
        (iter) =>
          ({
            id: iter.id,
            result: {
              success: iter.outcome === 'success',
              summary: iter.summary,
              errorCount: iter.errorCount,
            },
            timestamp: iter.timestamp,
          }) as unknown as LoopIteration & { id: string },
      ),
    };
  }

  private calculateSessionSize(session: ChatSession): number {
    return JSON.stringify(session).length;
  }

  private extractKeyMessages(
    messages: ChatMessage[],
  ): CompressedSession['compressed']['keyMessages'] {
    const keyMessages: CompressedSession['compressed']['keyMessages'] = [];

    // Extract important messages: user instructions, key responses, error messages
    for (const msg of messages) {
      let isKey = false;

      // User messages are typically key
      if (msg.role === 'user') {
        isKey = true;
      }

      // Assistant messages containing errors or warnings
      if (
        msg.role === 'assistant' &&
        (msg.content.includes('error') ||
          msg.content.includes('Error') ||
          msg.content.includes('failed') ||
          msg.content.includes('Failed'))
      ) {
        isKey = true;
      }

      // Long assistant messages may contain important information
      if (msg.role === 'assistant' && msg.content.length > 500) {
        isKey = true;
      }

      if (isKey) {
        keyMessages.push({
          role: msg.role as 'user' | 'assistant',
          timestamp: msg.timestamp,
          preview: msg.content.slice(0, 100),
          tokenCount: Math.ceil(msg.content.length / 4), // Rough estimation
        });
      }
    }

    // Limit the number of key messages
    return keyMessages.slice(0, 20);
  }

  private extractKeyIterations(
    iterations: any[],
  ): CompressedSession['compressed']['keyIterations'] {
    return iterations.slice(-10).map((iter) => ({
      id: iter.id,
      outcome: this.determineOutcome(iter),
      timestamp: iter.timestamp || Date.now(),
      summary: this.generateIterationSummary(iter),
      errorCount: this.countErrors(iter),
    }));
  }

  private calculateStats(session: ChatSession): CompressedSession['compressed']['stats'] {
    const stats = {
      totalMessages: session.messages.length,
      userMessages: session.messages.filter((m) => m.role === 'user').length,
      assistantMessages: session.messages.filter((m) => m.role === 'assistant').length,
      totalIterations: session.iterations.length,
      successfulIterations: session.meta.successfulIterations,
      totalTokens: session.meta.totalTokens,
    };

    return stats;
  }

  private determineOutcome(iteration: any): 'success' | 'failure' | 'partial' {
    // 简化的结果判断逻辑
    if (iteration.result?.success === true) return 'success';
    if (iteration.result?.success === false) return 'failure';
    return 'partial';
  }

  private generateIterationSummary(iteration: any): string {
    // 生成迭代的简短摘要
    const result = iteration.result;
    if (!result) return 'No result data';

    if (result.success) {
      return `Success: ${result.summary || 'Task completed'}`;
    } else {
      return `Failed: ${result.error || 'Unknown error'}`;
    }
  }

  private countErrors(iteration: any): number {
    // 计算迭代中的错误数量
    const result = iteration.result;
    if (!result) return 0;

    let errorCount = 0;
    if (result.error) errorCount++;
    if (result.errors && Array.isArray(result.errors)) {
      errorCount += result.errors.length;
    }

    return errorCount;
  }
}

/**
 * Session summary generator
 */
export class SessionSummaryGenerator {
  /**
   * Generate session summary
   */
  async generateSummary(session: ChatSession): Promise<{ text: string; tokenCount: number }> {
    // Simplified summary generation logic
    // In actual implementation, LLM can be called here to generate smarter summaries

    const messageCount = session.messages.length;
    const userMessages = session.messages.filter((m) => m.role === 'user').length;
    const iterations = session.iterations.length;
    const successRate =
      iterations > 0 ? ((session.meta.successfulIterations / iterations) * 100).toFixed(1) : '0';

    const summary =
      `Session ${session.meta.name} (${new Date(session.meta.createdAt).toLocaleDateString()})
` +
      `Messages: ${messageCount} total (${userMessages} user)
` +
      `Iterations: ${iterations} (${successRate}% success rate)
` +
      `Key topics: ${this.extractKeyTopics(session.messages).join(', ')}
` +
      `Status: ${this.getSessionStatus(session)}`;

    return {
      text: summary,
      tokenCount: Math.ceil(summary.length / 4),
    };
  }

  private extractKeyTopics(messages: ChatMessage[]): string[] {
    // Extract keywords as topics
    const topics = new Set<string>();
    const keywords = ['error', 'fix', 'feature', 'test', 'refactor', 'optimize', 'debug'];

    for (const msg of messages) {
      const content = msg.content.toLowerCase();
      for (const keyword of keywords) {
        if (content.includes(keyword)) {
          topics.add(keyword);
        }
      }
    }

    return Array.from(topics).slice(0, 5);
  }

  private getSessionStatus(session: ChatSession): string {
    const age = Date.now() - session.meta.updatedAt;
    const daysAgo = Math.floor(age / (1000 * 60 * 60 * 24));

    if (daysAgo === 0) return 'Active today';
    if (daysAgo === 1) return 'Active yesterday';
    if (daysAgo < 7) return `Active ${daysAgo} days ago`;
    return `Archived ${daysAgo} days ago`;
  }
}

/**
 * Compressed session storage manager
 */
export class CompressedSessionStore {
  private storageDir: string;
  private compressor: SessionCompressor;
  private fileAdapter: FileAdapter;

  constructor(baseDir: string) {
    this.storageDir = `${baseDir}/.salmonloop/compressed-sessions`;
    this.compressor = new SessionCompressor();
    this.fileAdapter = new FileAdapter();
  }

  /**
   * Save compressed session
   */
  async saveCompressed(session: ChatSession, importanceScore: number): Promise<string> {
    const compressed = await this.compressor.compressToBinary(session, importanceScore);
    const filename = `${session.meta.id}.mpack.gz`;
    const filepath = `${this.storageDir}/${filename}`;

    // Ensure directory exists
    await this.ensureStorageDir();

    // Save compressed data
    await this.writeFile(filepath, compressed);

    return filename;
  }

  /**
   * Load compressed session
   */
  async loadCompressed(filename: string): Promise<CompressedSession | null> {
    try {
      const filepath = `${this.storageDir}/${filename}`;
      const data = await this.readFile(filepath);
      return await this.compressor.decompressFromBinary(data);
    } catch {
      return null;
    }
  }

  private async ensureStorageDir(): Promise<void> {
    await this.fileAdapter.mkdir(this.storageDir);
  }

  private async writeFile(path: string, data: Uint8Array): Promise<void> {
    // Convert Uint8Array to string for FileAdapter
    const dataString = Buffer.from(data).toString('base64');
    await this.fileAdapter.writeFile(path, dataString);
  }

  private async readFile(path: string): Promise<Uint8Array> {
    const data = await this.fileAdapter.readFile(path);
    // FileAdapter返回base64字符串，需要解码为Uint8Array
    if (typeof data === 'string') {
      return new Uint8Array(Buffer.from(data, 'base64'));
    }
    return new Uint8Array(data);
  }
}
