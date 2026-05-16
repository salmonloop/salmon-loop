import { mkdir, writeFile, rm } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';

import { SessionCompressor } from '../../src/core/session/compression.js';
import { ChatSessionManager } from '../../src/core/session/manager.js';
import {
  SessionPruningEngine,
  calculateDefaultImportanceScore,
} from '../../src/core/session/pruning-strategy.js';
import type { ChatSession } from '../../src/core/session/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('Memory System Optimization', () => {
  const testDir = join(__dirname, '../tmp/memory-test');
  const sessionsDir = join(testDir, '.salmonloop', 'chat-sessions');

  beforeEach(async () => {
    // Create test directory
    await mkdir(testDir, { recursive: true });
    await mkdir(sessionsDir, { recursive: true });
  });

  afterEach(async () => {
    // Clean up test directory
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('Session Pruning Strategy', () => {
    it('should calculate importance score correctly', () => {
      const session: ChatSession = {
        meta: {
          id: 'test-session',
          name: 'Test Session',
          repoPath: testDir,
          createdAt: Date.now() - 1000 * 60 * 60 * 24 * 5, // 5 days ago
          updatedAt: Date.now() - 1000 * 60 * 60 * 24 * 1, // 1 day ago
          totalIterations: 10,
          successfulIterations: 8,
          totalTokens: { input: 5000, output: 3000 },
          snapshots: [
            { id: 'snapshot1', iterationId: 'iter1', timestamp: Date.now() },
            { id: 'snapshot2', iterationId: 'iter2', timestamp: Date.now() },
          ],
        },
        messages: [
          { role: 'user', content: 'Test message 1', timestamp: Date.now() },
          { role: 'assistant', content: 'Test response 1', timestamp: Date.now() },
          { role: 'user', content: 'Test message 2', timestamp: Date.now() },
        ],
        iterations: [],
      };

      const score = calculateDefaultImportanceScore(session);

      // Verify score calculation
      expect(score).toBeGreaterThan(0);
      expect(score).toBeLessThanOrEqual(100); // Reasonable score range

      // Verify the impact of various factors on the score
      const scoreWithoutSnapshots = calculateDefaultImportanceScore({
        ...session,
        meta: { ...session.meta, snapshots: [] },
      });
      expect(score).toBeGreaterThan(scoreWithoutSnapshots);
    });

    it('should analyze sessions and suggest cleanup correctly', async () => {
      const pruningEngine = new SessionPruningEngine({
        maxAgeDays: 30,
        maxSessions: 5,
        autoPrune: false,
      });

      // Create test sessions
      const sessions: ChatSession[] = [];

      // Create important session (newly created, with successful iterations)
      const importantSession: ChatSession = {
        meta: {
          id: 'important-session',
          name: 'Important Session',
          repoPath: testDir,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          totalIterations: 5,
          successfulIterations: 5,
          totalTokens: { input: 10000, output: 8000 },
          snapshots: [{ id: 'snap1', iterationId: 'iter1', timestamp: Date.now() }],
        },
        messages: Array.from({ length: 20 }, (_, i) => ({
          role: i % 2 === 0 ? 'user' : 'assistant',
          content: `Message ${i + 1}`,
          timestamp: Date.now(),
        })),
        iterations: [],
      };

      // Create low importance session (expired, no successful iterations)
      const lowPrioritySession: ChatSession = {
        meta: {
          id: 'low-priority-session',
          name: 'Low Priority Session',
          repoPath: testDir,
          createdAt: Date.now() - 1000 * 60 * 60 * 24 * 40, // 40 days ago
          updatedAt: Date.now() - 1000 * 60 * 60 * 24 * 40,
          totalIterations: 2,
          successfulIterations: 0,
          totalTokens: { input: 100, output: 50 },
          snapshots: [],
        },
        messages: [
          { role: 'user', content: 'Test', timestamp: Date.now() - 1000 * 60 * 60 * 24 * 40 },
        ],
        iterations: [],
      };

      sessions.push(importantSession, lowPrioritySession);

      // Save sessions to file system
      for (const session of sessions) {
        const filePath = join(sessionsDir, `${session.meta.id}.json`);
        await writeFile(filePath, JSON.stringify(session, null, 2));
      }

      // Analyze sessions
      const analysis = pruningEngine.analyzeSessions(sessions);

      expect(analysis.summary.totalSessions).toBe(2);
      expect(analysis.sessionsToKeep).toContain('important-session');
      expect(analysis.sessionsToDelete).toContain('low-priority-session');
    });
  });

  describe('Session Compression', () => {
    it('should compress session correctly', async () => {
      const compressor = new SessionCompressor();

      const session: ChatSession = {
        meta: {
          id: 'compress-test-session',
          name: 'Compression Test Session',
          repoPath: testDir,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          totalIterations: 3,
          successfulIterations: 2,
          totalTokens: { input: 2000, output: 1500 },
          snapshots: [{ id: 'snap1', iterationId: 'iter1', timestamp: Date.now() }],
        },
        messages: [
          {
            role: 'user',
            content: 'Create a function to calculate fibonacci numbers',
            timestamp: Date.now(),
          },
          {
            role: 'assistant',
            content: "I'll help you create a fibonacci function. Here's the implementation...",
            timestamp: Date.now(),
          },
          { role: 'user', content: 'Can you optimize it for performance?', timestamp: Date.now() },
          {
            role: 'assistant',
            content: "Yes, here's an optimized version using memoization...",
            timestamp: Date.now(),
          },
        ],
        iterations: [
          {
            id: 'iter1',
            result: { success: true, summary: 'Created fibonacci function' },
            timestamp: Date.now(),
          } as any,
        ],
      };

      const importanceScore = 85.5;
      const compressed = await compressor.compress(session, importanceScore);

      // Verify compression results
      expect(compressed.meta.id).toBe(session.meta.id);
      expect(compressed.meta.name).toBe(session.meta.name);
      expect(compressed.meta.importanceScore).toBe(importanceScore);
      expect(compressed.meta.compressionRatio).toBeGreaterThan(0);

      // Verify summary generation
      expect(compressed.compressed.summary).toBeTruthy();
      expect(compressed.compressed.summaryTokens).toBeGreaterThan(0);

      // Verify key messages extraction
      expect(compressed.compressed.keyMessages.length).toBeGreaterThan(0);
      expect(compressed.compressed.keyMessages.length).toBeLessThanOrEqual(session.messages.length);

      // Verify statistics
      expect(compressed.compressed.stats.totalMessages).toBe(session.messages.length);
      expect(compressed.compressed.stats.userMessages).toBe(2);
      expect(compressed.compressed.stats.assistantMessages).toBe(2);
      expect(compressed.compressed.stats.successfulIterations).toBe(2);
    });

    it('should handle binary compression and decompression', async () => {
      const compressor = new SessionCompressor();

      const session: ChatSession = {
        meta: {
          id: 'binary-test-session',
          name: 'Binary Test Session',
          repoPath: testDir,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          totalIterations: 1,
          successfulIterations: 1,
          totalTokens: { input: 1000, output: 800 },
          snapshots: [],
        },
        messages: [
          { role: 'user', content: 'Test message', timestamp: Date.now() },
          { role: 'assistant', content: 'Test response', timestamp: Date.now() },
        ],
        iterations: [],
      };

      const importanceScore = 75.0;

      // Test binary compression
      const compressedBinary = await compressor.compressToBinary(session, importanceScore);
      expect(compressedBinary).toBeInstanceOf(Uint8Array);
      expect(compressedBinary.length).toBeGreaterThan(0);

      // Test decompression
      const decompressed = await compressor.decompressFromBinary(compressedBinary);
      expect(decompressed.meta.id).toBe(session.meta.id);
      expect(decompressed.meta.name).toBe(session.meta.name);
      expect(decompressed.meta.importanceScore).toBe(importanceScore);
    });
  });

  describe('ChatSessionManager Integration', () => {
    it('should perform auto cleanup correctly', async () => {
      const manager = new ChatSessionManager(testDir, {
        maxAgeDays: 1, // Set to 1 day for testing
        maxSessions: 2,
        autoPrune: true,
      });

      await manager.init();

      // Create multiple test sessions
      const _session1 = await manager.create('Recent Important Session');
      const _session2 = await manager.create('Recent Session 2');
      const _session3 = await manager.create('Recent Session 3');

      // Add some messages and iterations to the current session
      manager.addMessage({
        role: 'user',
        content: 'Test instruction',
        timestamp: Date.now(),
      });
      manager.addMessage({
        role: 'assistant',
        content: 'Test response',
        timestamp: Date.now(),
      });

      // Verify initial session count
      const initialSessions = await manager.listSessions();
      expect(initialSessions.length).toBe(3);

      // Perform cleanup (since maxSessions=2, should delete 1 session)
      const cleanupResult = await manager.performAutoCleanup();

      expect(cleanupResult.deleted).toBeGreaterThanOrEqual(0);
      expect(cleanupResult.archived).toBeGreaterThanOrEqual(0);
      expect(cleanupResult.kept).toBeLessThanOrEqual(2);

      // Verify session count after cleanup
      const remainingSessions = await manager.listSessions();
      expect(remainingSessions.length).toBeLessThanOrEqual(2);
    });

    it('should calculate session scores correctly', async () => {
      const manager = new ChatSessionManager(testDir);
      await manager.init();

      const session = await manager.create('Score Test Session');

      // Add successful iteration to increase score
      const iterationId = manager.addIteration({
        result: { success: true, summary: 'Task completed successfully' },
      } as any);

      manager.addMessage({
        role: 'assistant',
        content: 'Task completed successfully',
        timestamp: Date.now(),
        iterationId,
      });

      const score = manager.getSessionScore(session);
      expect(score).toBeGreaterThan(0);
      expect(score).toBeGreaterThanOrEqual(10); // Should have at least the bonus for successful iterations
    });

    it('should archive sessions correctly', async () => {
      const manager = new ChatSessionManager(testDir);
      await manager.init();

      const session = await manager.create('Archive Test Session');
      manager.addMessage({
        role: 'user',
        content: 'This session will be archived',
        timestamp: Date.now(),
      });

      // Archive session
      const archiveId = await manager.archiveSession(session);
      expect(archiveId).toBeTruthy();
      expect(typeof archiveId).toBe('string');
    });
  });

  describe('Performance Tests', () => {
    it('should handle large number of sessions efficiently', async () => {
      const manager = new ChatSessionManager(testDir);
      await manager.init();

      const startTime = Date.now();

      // Create large number of sessions
      const sessionCount = 500;
      for (let i = 0; i < sessionCount; i++) {
        await manager.create(`Performance Test Session ${i + 1}`);
        manager.addMessage({
          role: 'user',
          content: `Test message ${i + 1}`,
          timestamp: Date.now(),
        });
      }

      const creationTime = Date.now() - startTime;
      console.log(`Created ${sessionCount} sessions in ${creationTime}ms`);

      // Test cleanup performance
      const cleanupStart = Date.now();
      const cleanupResult = await manager.performAutoCleanup();
      const cleanupTime = Date.now() - cleanupStart;

      console.log(`Cleanup completed in ${cleanupTime}ms`);
      console.log(
        `Deleted: ${cleanupResult.deleted}, Archived: ${cleanupResult.archived}, Kept: ${cleanupResult.kept}`,
      );

      // Verify performance (should complete within reasonable time)
      expect(creationTime).toBeLessThan(10000); // Create 100 sessions within 10 seconds
      expect(cleanupTime).toBeLessThan(5000); // Complete cleanup within 5 seconds
    }, 30000); // Increase timeout
  });
});
