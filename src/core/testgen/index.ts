import { writeFile } from 'fs/promises';
import { join } from 'path';

import { detectProjectType } from './detector.js';
import { NODE_TEMPLATE, PYTHON_TEMPLATE, JAVA_TEMPLATE, GO_TEMPLATE } from './templates.js';

export async function injectSmokeTest(
  repoPath: string,
): Promise<{ created: boolean; testCommand: string }> {
  const type = detectProjectType(repoPath);
  let fileName = '';
  let content = '';
  let testCommand = '';

  switch (type) {
    case 'nodejs':
      fileName = 'salmon_smoke_test.js';
      content = NODE_TEMPLATE;
      testCommand = 'node salmon_smoke_test.js';
      break;
    case 'python':
      fileName = 'salmon_smoke_test.py';
      content = PYTHON_TEMPLATE;
      testCommand = 'python salmon_smoke_test.py';
      break;
    case 'java_maven':
    case 'java_gradle':
      fileName = 'SalmonSmokeTest.java';
      content = JAVA_TEMPLATE;
      testCommand = 'java SalmonSmokeTest.java';
      break;
    case 'go':
      fileName = 'salmon_smoke_test.go';
      content = GO_TEMPLATE;
      testCommand = 'go run salmon_smoke_test.go';
      break;
    default:
      return { created: false, testCommand: '' };
  }

  await writeFile(join(repoPath, fileName), content, 'utf-8');
  return { created: true, testCommand };
}
