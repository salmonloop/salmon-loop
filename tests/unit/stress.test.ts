import { AstParser } from '../../src/core/ast/parser.js';
import { monitor } from '../../src/core/observability/monitor.js';

async function testStability(onProgress?: (iteration: number, heapUsed: number) => void) {
  const code = `function hello() { console.log('world'); }`;

  for (let i = 0; i < 1000; i++) {
    await AstParser.parse(code, 'javascript');

    if (i % 100 === 0) {
      let usage: NodeJS.MemoryUsage;
      try {
        usage = process.memoryUsage();
      } catch {
        continue;
      }
      const heapUsed = usage.heapUsed / 1024 / 1024;
      onProgress?.(i, heapUsed);
      monitor.checkMemoryUsage();
    }
  }
}

describe('Memory Stability', () => {
  it('should not leak memory after repeated AST parsing', async () => {
    const progress: { iteration: number; heapUsed: number }[] = [];

    await testStability((iteration, heapUsed) => {
      progress.push({ iteration, heapUsed });
    });

    // Verify progress was recorded at expected intervals
    expect(progress.length).toBe(10);
    expect(progress[0].iteration).toBe(0);
    expect(progress[progress.length - 1].iteration).toBe(900);

    // Verify memory stayed within reasonable bounds (not exceeding 500MB)
    const maxHeap = Math.max(...progress.map((p) => p.heapUsed));
    expect(maxHeap).toBeLessThan(500);
  });
});
