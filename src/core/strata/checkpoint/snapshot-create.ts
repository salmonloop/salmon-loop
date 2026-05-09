import { randomBytes } from 'crypto';
import { tmpdir } from 'os';
import { join } from 'path';

import { rm } from '../../adapters/fs/node-fs.js';
import { GitAdapter } from '../../adapters/git/git-adapter.js';
import { normalizePath } from '../../utils/path.js';

export type SnapshotCreateStep = 'read-tree' | 'add-u' | 'write-tree-final' | 'commit-tree';

async function getSafeUntrackedFiles(git: GitAdapter): Promise<string[]> {
  // --exclude-standard: Respect .gitignore
  // -o: List other (untracked) files
  const output = await git.query(['ls-files', '-o', '--exclude-standard']);
  const files = output.split('\n').filter((f: string) => f.trim());

  // Hardcoded blacklist for double safety
  return files.filter((f: string) => {
    const normalized = normalizePath(f);
    return (
      !normalized.includes('node_modules/') &&
      !normalized.includes('.env') &&
      !normalized.includes('.git/') &&
      !normalized.includes('dist/') &&
      !normalized.includes('build/')
    );
  });
}

export async function createSnapshotCommitFromStagedTree(input: {
  git: GitAdapter;
  stagedTree: string;
  includePaths: string[];
  message?: string;
  onStep?: (step: SnapshotCreateStep) => void;
}): Promise<string> {
  const { git, stagedTree, includePaths, message, onStep } = input;
  const random = randomBytes(4).toString('hex');
  const tempIndexFile = join(tmpdir(), `s8p-idx-${Date.now()}-${random}`);
  const env = { GIT_INDEX_FILE: tempIndexFile };

  try {
    // We use the staged tree as the base because it contains all tracked files
    // (including newly added ones), while HEAD may not.
    onStep?.('read-tree');
    await git.exec(['read-tree', stagedTree], { env });

    // Update tracked files (Modified/Deleted) from working tree.
    onStep?.('add-u');
    await git.exec(['add', '-u', '.'], { env });

    const untracked = await getSafeUntrackedFiles(git);
    if (untracked.length > 0) {
      await git.exec(['add', '--', ...untracked], { env });
    }

    // Explicit include list supports ignored paths when needed.
    if (includePaths.length > 0) {
      // Process in batches of 50 to avoid hitting command line length limits
      for (let i = 0; i < includePaths.length; i += 50) {
        const batch = includePaths.slice(i, i + 50);
        try {
          // Check which files in this batch are ignored
          // git check-ignore returns stdout with matching files, or exits with 1 if none match
          let ignoredOutput = '';
          try {
            ignoredOutput = await git.exec(['check-ignore', ...batch]);
          } catch (e: any) {
            ignoredOutput = e.stdout || '';
          }

          const ignoredSet = new Set(
            ignoredOutput
              .split('\n')
              .map((f: string) => f.trim())
              .filter(Boolean),
          );

          const ignoredFiles = batch.filter((f) => ignoredSet.has(f));
          const normalFiles = batch.filter((f) => !ignoredSet.has(f));

          if (ignoredFiles.length > 0) {
            await git.exec(['add', '-f', '--', ...ignoredFiles], { env });
          }

          if (normalFiles.length > 0) {
            await git.exec(['add', '--', ...normalFiles], { env });
          }
        } catch {
          // Ignore batch add failures to keep snapshot best-effort.
        }
      }
    }

    onStep?.('write-tree-final');
    const workingTree = (await git.exec(['write-tree'], { env })).trim();

    const metadata = JSON.stringify({
      v: '1.0',
      staged: stagedTree,
      forced: includePaths,
      desc: message,
      ts: Date.now(),
    });

    onStep?.('commit-tree');
    return (
      await git.exec(['commit-tree', workingTree, '-p', 'HEAD', '-m', metadata], { env })
    ).trim();
  } finally {
    try {
      await rm(tempIndexFile, { force: true });
    } catch {
      // Ignore cleanup errors.
    }
  }
}
