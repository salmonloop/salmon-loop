#!/usr/bin/env tsx

/**
 * Session cleanup tool script
 * Used for demonstration and testing memory system optimization features
 */

import { ChatSessionManager } from '../src/core/session/manager.js';
import {
  SessionPruningEngine,
  calculateDefaultImportanceScore,
} from '../src/core/session/pruning-strategy.js';

async function main() {
  const repoPath = process.cwd();
  const manager = new ChatSessionManager(repoPath);

  console.log('🔍 Analyzing current session status...');

  try {
    // Initialize session manager
    await manager.init();

    // Get all sessions
    const sessions = await manager.listSessions();
    console.log(`📊 Found ${sessions.length} sessions`);

    if (sessions.length === 0) {
      console.log('💡 No session files found, no cleanup needed');
      return;
    }

    // Display session statistics
    console.log('\n📈 Session statistics:');
    sessions.slice(0, 10).forEach((session, index) => {
      const ageInDays = Math.floor((Date.now() - session.updatedAt) / (1000 * 60 * 60 * 24));
      console.log(`  ${index + 1}. ${session.name} (${session.id.slice(0, 8)}...)`);
      console.log(`     Update time: ${new Date(session.updatedAt).toLocaleString()}`);
      console.log(`     Age: ${ageInDays} days`);
    });

    if (sessions.length > 10) {
      console.log(`  ... and ${sessions.length - 10} more sessions`);
    }

    // Execute cleanup analysis
    console.log('\n🧹 Executing cleanup analysis...');

    // Create custom cleanup strategy
    const customStrategy = {
      maxAgeDays: 30,
      maxSessions: 50,
      autoPrune: false, // Analyze only, do not actually delete
      gracePeriodDays: 7,
      importanceScoring: calculateDefaultImportanceScore,
    };

    const pruningEngine = new SessionPruningEngine(customStrategy);

    // Load complete session data for analysis
    const fullSessions = [];
    for (const sessionInfo of sessions) {
      try {
        const session = await manager.load(sessionInfo.id);
        if (session) {
          fullSessions.push(session);
        }
      } catch (error) {
        console.warn(`⚠️  Unable to load session ${sessionInfo.id}:`, error);
      }
    }

    console.log(`✅ Successfully loaded ${fullSessions.length} sessions for analysis`);

    // Analyze cleanup strategy
    const analysis = pruningEngine.analyzeSessions(fullSessions);

    console.log('\n📊 Cleanup analysis results:');
    console.log(`  🔄 Total sessions: ${analysis.summary.totalSessions}`);
    console.log(`  🗑️  Recommended for deletion: ${analysis.summary.deletedCount}`);
    console.log(`  📦 Recommended for archiving: ${analysis.summary.archivedCount}`);
    console.log(`  💎 Recommended for keeping: ${analysis.summary.keptCount}`);

    // Display sessions recommended for deletion
    if (analysis.sessionsToDelete.length > 0) {
      console.log('\n🗑️  Sessions recommended for deletion:');
      for (const sessionId of analysis.sessionsToDelete.slice(0, 5)) {
        const session = fullSessions.find((s) => s.meta.id === sessionId);
        if (session) {
          const score = pruningEngine.getSessionScore(session);
          const ageInDays = Math.floor(
            (Date.now() - session.meta.createdAt) / (1000 * 60 * 60 * 24),
          );
          console.log(`  - ${session.meta.name} (${sessionId.slice(0, 8)}...)`);
          console.log(`    Importance score: ${score}, age: ${ageInDays} days`);
        }
      }
    }

    // Display sessions recommended for archiving
    if (analysis.sessionsToArchive.length > 0) {
      console.log('\n📦 Sessions recommended for archiving:');
      for (const sessionId of analysis.sessionsToArchive.slice(0, 5)) {
        const session = fullSessions.find((s) => s.meta.id === sessionId);
        if (session) {
          const score = pruningEngine.getSessionScore(session);
          const ageInDays = Math.floor(
            (Date.now() - session.meta.createdAt) / (1000 * 60 * 60 * 24),
          );
          console.log(`  - ${session.meta.name} (${sessionId.slice(0, 8)}...)`);
          console.log(`    Importance score: ${score}, age: ${ageInDays} days`);
        }
      }
    }

    // Display scoring details for important sessions
    console.log('\n🏆 Scoring details for most important sessions:');
    const topSessions = fullSessions
      .map((session) => ({
        session,
        score: pruningEngine.getSessionScore(session),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    for (const { session, score } of topSessions) {
      console.log(`  ⭐ ${session.meta.name} (${session.meta.id.slice(0, 8)}...)`);
      console.log(`     Score: ${score}`);
      console.log(
        `     Iterations: ${session.meta.successfulIterations}/${session.meta.totalIterations} successful`,
      );
      console.log(`     Snapshots: ${session.meta.snapshots.length} total`);
      console.log(`     Messages: ${session.messages.length} total`);
    }

    // Ask whether to execute cleanup
    console.log('\n⚠️  Cleanup operation will delete and archive session files');
    console.log('💡 Recommend backing up .salmonloop/chat-sessions directory first');

    const shouldExecute = process.argv.includes('--execute');

    if (shouldExecute) {
      console.log('\n🚀 Executing cleanup operation...');

      // Update strategy to actual execution mode
      manager.updatePruningStrategy({ autoPrune: true });

      const result = await manager.performAutoCleanup();

      console.log('\n✅ Cleanup completed!');
      console.log(`  Deleted: ${result.deleted} sessions`);
      console.log(`  Archived: ${result.archived} sessions`);
      console.log(`  Kept: ${result.kept} sessions`);

      // Display status after cleanup
      const remainingSessions = await manager.listSessions();
      console.log(`\n📊 Total sessions after cleanup: ${remainingSessions.length}`);
    } else {
      console.log('\n💡 Use --execute parameter to perform actual cleanup');
      console.log('💡 Example: bun run scripts/cleanup-sessions.ts --execute');
    }

    // Display storage optimization recommendations
    console.log('\n💡 Storage optimization recommendations:');
    console.log('  1. Run this cleanup script regularly');
    console.log('  2. Adjust cleanup strategy parameters to suit your needs');
    console.log(
      '  3. Important sessions are automatically preserved, no need to worry about data loss',
    );
    console.log('  4. Archived sessions can be restored at any time');
  } catch (error) {
    console.error('❌ Error during cleanup process:', error);
    process.exit(1);
  }
}

// Run main function
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}
