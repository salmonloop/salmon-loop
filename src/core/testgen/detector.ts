import { existsSync } from 'fs';
import { join } from 'path';

export type ProjectType = 'nodejs' | 'python' | 'java_maven' | 'java_gradle' | 'go' | 'unknown';

export function detectProjectType(repoPath: string): ProjectType {
  if (existsSync(join(repoPath, 'pom.xml'))) return 'java_maven';
  if (existsSync(join(repoPath, 'build.gradle'))) return 'java_gradle';
  if (
    existsSync(join(repoPath, 'requirements.txt')) ||
    existsSync(join(repoPath, 'pyproject.toml'))
  )
    return 'python';
  if (existsSync(join(repoPath, 'go.mod'))) return 'go';
  if (existsSync(join(repoPath, 'package.json'))) return 'nodejs';
  return 'unknown';
}
