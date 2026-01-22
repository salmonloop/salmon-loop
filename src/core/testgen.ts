import { writeFile } from 'fs/promises';
import { join } from 'path';

import { logger } from './logger.js';
import { detectProjectType } from './testgen/detector.js';
import { NODE_TEMPLATE, PYTHON_TEMPLATE, JAVA_TEMPLATE, GO_TEMPLATE } from './testgen/templates.js';

/**
 * Generates a basic smoke test file for the target project.
 * Supports Node.js, Python, Java, and Go.
 *
 * @param repoPath - The root path of the repository
 * @returns Object containing success status and the command to run the test
 */
export async function injectSmokeTest(
  repoPath: string,
): Promise<{ created: boolean; testCommand?: string }> {
  const type = detectProjectType(repoPath);

  try {
    if (type === 'nodejs') {
      const testPath = join(repoPath, 'salmon-smoke-test.js');
      await writeFile(testPath, NODE_TEMPLATE, 'utf-8');
      logger.info(`Generated Node.js smoke test at ${testPath}`);
      return { created: true, testCommand: 'node salmon-smoke-test.js' };
    }

    if (type === 'python') {
      const testPath = join(repoPath, 'salmon_smoke_test.py');
      await writeFile(testPath, PYTHON_TEMPLATE, 'utf-8');
      logger.info(`Generated Python smoke test at ${testPath}`);
      return { created: true, testCommand: 'python salmon_smoke_test.py' };
    }

    if (type === 'java_maven' || type === 'java_gradle') {
      const testPath = join(repoPath, 'SalmonSmokeTest.java');
      await writeFile(testPath, JAVA_TEMPLATE, 'utf-8');
      logger.info(`Generated Java smoke test at ${testPath}`);
      return {
        created: true,
        testCommand: 'javac SalmonSmokeTest.java && java SalmonSmokeTest',
      };
    }

    if (type === 'go') {
      const testPath = join(repoPath, 'salmon_smoke_test.go');
      await writeFile(testPath, GO_TEMPLATE, 'utf-8');
      logger.info(`Generated Go smoke test at ${testPath}`);
      return { created: true, testCommand: 'go run salmon_smoke_test.go' };
    }

    logger.warn(`Unknown project type at ${repoPath}, skipping smoke test injection.`);
    return { created: false };
  } catch (e) {
    logger.error(`Failed to inject smoke test: ${e instanceof Error ? e.message : String(e)}`);
    return { created: false };
  }
}
