import { describe, it } from 'vitest';

import { AstParser } from '../../src/core/ast/parser.js';
import { monitor } from '../../src/core/monitor.js';

async function testStability() {
  const code = `function hello() { console.log('world'); }`;
  console.log('Starting stability test (1000 iterations)...');

  for (let i = 0; i < 1000; i++) {
    await AstParser.parse(code, 'javascript');

    if (i % 100 === 0) {
      const usage = process.memoryUsage();
      console.log(`Iteration ${i}: Heap Used = ${(usage.heapUsed / 1024 / 1024).toFixed(2)} MB`);
      monitor.checkMemoryUsage();
    }
  }

  console.log('Stability test completed.');
}

describe('Memory Stability', () => {
  it('should not leak memory after repeated AST parsing', async () => {
    await testStability();
  });
});
