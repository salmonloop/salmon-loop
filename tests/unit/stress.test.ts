import { AstParser } from '../../src/core/ast/parser.js';
import { Monitor } from '../../src/core/observability/monitor.js';

async function testStability(
  onProgress?: (iteration: number, heapUsedMb: number | undefined) => void,
) {
  const monitor = new Monitor();
  const code = `function hello() { console.log('world'); }`;

  for (let i = 0; i < 1000; i++) {
    await AstParser.parse(code, 'javascript');

    if (i % 100 === 0) {
      let heapUsedMb: number | undefined;
      try {
        const usage = process.memoryUsage();
        const heapUsed = usage?.heapUsed;
        if (typeof heapUsed === 'number' && Number.isFinite(heapUsed)) {
          heapUsedMb = heapUsed / 1024 / 1024;
        }
      } catch {
        // Some runtimes may throw under heavy parallel test load. Record the iteration anyway.
      }
      onProgress?.(i, heapUsedMb);
      monitor.checkMemoryUsage();
    }
  }
}

describe('Memory Stability', () => {
  it('should not leak memory after repeated AST parsing', async () => {
    const progress: { iteration: number; heapUsedMb: number | undefined }[] = [];

    await testStability((iteration, heapUsedMb) => {
      progress.push({ iteration, heapUsedMb });
    });

    // Verify progress was recorded at expected intervals
    expect(progress.length).toBe(10);
    expect(progress.map((p) => p.iteration)).toEqual([
      0, 100, 200, 300, 400, 500, 600, 700, 800, 900,
    ]);

    // Verify memory stayed within reasonable bounds (not exceeding 500MB)
    const heapSamples = progress
      .map((p) => p.heapUsedMb)
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    expect(heapSamples.length).toBeGreaterThanOrEqual(8);

    const maxHeap = Math.max(...heapSamples);
    expect(maxHeap).toBeLessThan(500);
  });
});
