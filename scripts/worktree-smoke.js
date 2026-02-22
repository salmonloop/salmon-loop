import { execa } from 'execa';

import { GitAdapter } from '../src/core/adapters/git/git-adapter.js';
import { CheckpointManager } from '../src/core/strata/checkpoint/manager.js';
import { ShadowDriver } from '../src/core/strata/layers/shadow-driver/shadow-driver.js';
import { WorkspaceManager } from '../src/core/strata/layers/worktree.js';

function getDefaultCommand() {
  return {
    command: 'bun',
    args: ['run', 'vitest', 'run', 'tests/integration/external-plugin.test.ts'],
  };
}

function parseArgs(rawArgs) {
  const args = [...rawArgs];

  let keepWorktree = false;
  let keepSnapshot = false;

  while (args.length > 0) {
    const next = args[0];
    if (next === '--keep-worktree') {
      keepWorktree = true;
      args.shift();
      continue;
    }
    if (next === '--keep-snapshot') {
      keepSnapshot = true;
      args.shift();
      continue;
    }
    if (next === '--') {
      args.shift();
      break;
    }
    break;
  }

  const command = args[0];
  const cmdArgs = args.slice(1);

  return {
    keepWorktree,
    keepSnapshot,
    command,
    args: cmdArgs,
  };
}

async function main() {
  const repoPath = process.cwd();
  const { keepWorktree, keepSnapshot, command, args } = parseArgs(process.argv.slice(2));

  const checkpointManager = new CheckpointManager();
  let snapshotHash;
  let workspace;

  try {
    const snapshot = await checkpointManager.createSafeSnapshot(repoPath, [], 'worktree smoke');
    snapshotHash = snapshot.commitHash;

    workspace = await WorkspaceManager.setup(
      {
        instruction: 'worktree smoke',
        repoPath,
        dryRun: true,
        strategy: 'worktree',
      },
      snapshotHash,
    );

    await checkpointManager.restoreToShadow(repoPath, workspace.workPath, snapshotHash);
    await new GitAdapter(workspace.workPath).query(['status', '--short']);
    await ShadowDriver.hydrate(repoPath, workspace.workPath);

    const toRun = command ? { command, args } : getDefaultCommand();
    await execa(toRun.command, toRun.args, { cwd: workspace.workPath, stdio: 'inherit' });

    console.log('✅ Worktree smoke run succeeded');
  } finally {
    if (workspace && !keepWorktree) {
      await WorkspaceManager.teardown(workspace);
    }
    if (snapshotHash && !keepSnapshot) {
      await checkpointManager.deleteSnapshot(repoPath, snapshotHash);
    }
  }
}

main().catch((error) => {
  console.error('❌ Worktree smoke run failed');
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
