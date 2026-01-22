/**
 * Fuzz testing script for SalmonLoop.
 * Generates random invalid inputs to test system stability.
 */

import fs from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { LLM } from '../src/core/llm.js';
import { runSalmonLoop } from '../src/core/loop.js';

class MockLLM extends LLM {
  async createPlan() {
    return {
      goal: 'Fuzzing goal',
      files: ['fuzz.txt'],
      changes: ['Fuzzing change'],
      verify: 'echo fuzz',
    };
  }
  async createPatch() {
    // Generate random garbage diff
    return `diff --git a/fuzz.txt b/fuzz.txt
--- a/fuzz.txt
+++ b/fuzz.txt
@@ -1 +1 @@
-${Math.random().toString(36)}
+${Math.random().toString(36)}
`;
  }
}

async function runFuzz(iterations = 10) {
  const testRepoPath = join(tmpdir(), `salmon-fuzz-${Date.now()}`);
  await fs.mkdir(testRepoPath, { recursive: true });

  // Initialize dummy git repo
  const { execSync } = await import('child_process');
  execSync('git init', { cwd: testRepoPath });
  await fs.writeFile(join(testRepoPath, 'fuzz.txt'), 'initial content');
  execSync('git add . && git commit -m "initial"', { cwd: testRepoPath });

  console.log(`🚀 Starting fuzz testing for ${iterations} iterations...`);

  for (let i = 0; i < iterations; i++) {
    console.log(`Iteration ${i + 1}/${iterations}...`);
    try {
      await runSalmonLoop({
        instruction: `Random instruction ${Math.random()}`,
        verify: 'echo verified',
        repoPath: testRepoPath,
        llm: new MockLLM({ apiKey: 'fuzz' }),
        verbose: 'basic',
      });
    } catch (e) {
      console.error(`❌ Fuzzing iteration ${i + 1} crashed:`, e);
    }
  }

  console.log('✅ Fuzz testing completed.');
  await fs.rm(testRepoPath, { recursive: true, force: true });
}

runFuzz().catch(console.error);
