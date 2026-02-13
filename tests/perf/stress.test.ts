import { AstParser } from '../../src/core/ast/parser.js';
import { monitor } from '../../src/core/observability/monitor.js';

async function testStability() {
  const code = `function hello() { console.log('world'); }`;

  for (let i = 0; i < 1000; i++) {
    await AstParser.parse(code, 'javascript');

    if (i % 100 === 0) {
      monitor.checkMemoryUsage();
    }
  }
}

describe('Memory Stability', () => {
  it('should not leak memory after repeated AST parsing', async () => {
    await testStability();
  });
});
