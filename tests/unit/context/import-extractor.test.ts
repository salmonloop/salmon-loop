import { extractImportSpecifiers } from '../../../src/core/context/ast/import-extractor';

describe('extractImportSpecifiers', () => {
  it('extracts ESM and CJS specifiers', () => {
    const code = [
      "import { a } from './a.js';",
      "import './side-effect';",
      "const x = require('../b');",
      "await import('./dyn');",
    ].join('\n');

    expect(extractImportSpecifiers(code)).toEqual(['./a.js', './side-effect', '../b', './dyn']);
  });

  it('deduplicates while preserving order', () => {
    const code = "import { a } from './a';\nimport { b } from './a';\n";
    expect(extractImportSpecifiers(code)).toEqual(['./a']);
  });
});
