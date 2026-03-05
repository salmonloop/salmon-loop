import { resolve } from 'path';

import chalk from 'chalk';
import { Command } from 'commander';

import { CheckpointManager, getLogger } from '../../core/facades/cli-command-checkpoint.js';
import { text } from '../locales/index.js';

export async function handleSnapshotList(_options: any, command: Command) {
  const allOptions = command.optsWithGlobals();
  const runPath = resolve(allOptions.repo || process.cwd());
  const manager = new CheckpointManager();
  const snapshots = await manager.listSnapshots(runPath);

  if (snapshots.length === 0) {
    getLogger().log(text.cli.noSnapshots);
    return;
  }

  getLogger().log(chalk.bold(text.cli.availableSnapshots));
  getLogger().log(chalk.dim(text.cli.snapshotTableHead));

  snapshots.forEach((s) => {
    // Parse the message to extract the description if available.
    let displayMsg = s.message;
    try {
      const meta = JSON.parse(s.message);
      if (meta.desc) {
        displayMsg = meta.desc;
      } else if (meta.staged) {
        // Fallback for auto-snapshots without explicit description.
        displayMsg = text.cli.autoSnapshotMsg(meta.staged.substring(0, 7));
      }
    } catch {
      // Keep original message if parsing fails.
    }
    getLogger().log(`${chalk.cyan(s.hash)}  ${chalk.gray(s.timestamp)}  ${displayMsg}`);
  });
}

export async function handleSnapshotCreate(options: any, command: Command) {
  const allOptions = command.optsWithGlobals();
  const runPath = resolve(allOptions.repo || process.cwd());
  const manager = new CheckpointManager();

  try {
    const result = await manager.createSafeSnapshot(
      runPath,
      options.include || [],
      options.message,
    );
    getLogger().success(text.cli.snapshotCreated(result.commitHash));
    if (options.message) {
      getLogger().log(text.cli.snapshotMessage(options.message));
    }
  } catch (error) {
    getLogger().error(
      text.cli.snapshotCreateFailed(error instanceof Error ? error.message : String(error)),
    );
    process.exit(1);
  }
}

export async function handleSnapshotShow(hash: string, options: any, command: Command) {
  const allOptions = command.optsWithGlobals();
  const runPath = resolve(allOptions.repo || process.cwd());
  const manager = new CheckpointManager();

  try {
    const details = await manager.getSnapshotDetails(runPath, hash);
    getLogger().log(chalk.bold(text.cli.snapshotDetails(hash)));

    if (details.stagedFiles.length > 0) {
      getLogger().log(chalk.green('\n' + text.cli.stagedFiles));
      details.stagedFiles.forEach((f) => getLogger().log(`  ${f}`));
    } else {
      getLogger().log(chalk.gray('\n' + text.cli.noStagedFiles));
    }

    if (details.unstagedFiles.length > 0) {
      getLogger().log(chalk.yellow('\n' + text.cli.unstagedChanges));
      details.unstagedFiles.forEach((f) => getLogger().log(`  ${f}`));
    } else {
      getLogger().log(chalk.gray('\n' + text.cli.noUnstagedChanges));
    }

    if (options.files) {
      getLogger().log(chalk.blue('\n' + text.cli.allFilesInSnapshot));
      const files = await manager.getSnapshotFiles(runPath, hash);
      files.forEach((f) => getLogger().log(`  ${f}`));
    }
  } catch (error) {
    getLogger().error(
      text.cli.snapshotShowFailed(error instanceof Error ? error.message : String(error)),
    );
    process.exit(1);
  }
}

export async function handleSnapshotDiff(
  hash: string,
  otherHash: string | undefined,
  options: any,
  command: Command,
) {
  const allOptions = command.optsWithGlobals();
  const runPath = resolve(allOptions.repo || process.cwd());
  const manager = new CheckpointManager();

  try {
    const diffOutput = await manager.getSnapshotDiff(runPath, hash, otherHash, options.code);
    if (!diffOutput.trim()) {
      getLogger().log(text.cli.noDifferences);
    } else {
      process.stdout.write(diffOutput + '\n');
    }
  } catch (error) {
    getLogger().error(
      text.cli.getDiffFailed(error instanceof Error ? error.message : String(error)),
    );
    process.exit(1);
  }
}

export async function handleSnapshotCat(
  hash: string,
  file: string,
  _options: any,
  command: Command,
) {
  const allOptions = command.optsWithGlobals();
  const runPath = resolve(allOptions.repo || process.cwd());
  const manager = new CheckpointManager();

  try {
    const content = await manager.getSnapshotFileContent(runPath, hash, file);
    process.stdout.write(content);
  } catch (error) {
    getLogger().error(
      text.cli.readFileFailed(error instanceof Error ? error.message : String(error)),
    );
    process.exit(1);
  }
}

export async function handleSnapshotExport(
  hash: string,
  directory: string,
  _options: any,
  command: Command,
) {
  const allOptions = command.optsWithGlobals();
  const runPath = resolve(allOptions.repo || process.cwd());
  const targetDir = resolve(directory);
  const manager = new CheckpointManager();

  try {
    getLogger().info(text.cli.exportStarting(hash, targetDir));
    await manager.exportSnapshot(runPath, hash, targetDir);
    getLogger().success(text.cli.exportSuccess(hash));
  } catch (error) {
    getLogger().error(
      text.cli.exportFailed(error instanceof Error ? error.message : String(error)),
    );
    process.exit(1);
  }
}

export async function handleSnapshotDelete(hash: string, _options: any, command: Command) {
  const allOptions = command.optsWithGlobals();
  const runPath = resolve(allOptions.repo || process.cwd());
  const manager = new CheckpointManager();

  try {
    await manager.deleteSnapshot(runPath, hash);
    getLogger().success(text.cli.snapshotDeleted(hash));
  } catch (error) {
    getLogger().error(
      text.cli.snapshotDeleteFailed(error instanceof Error ? error.message : String(error)),
    );
    process.exit(1);
  }
}

export async function handleSnapshotClear(options: any, command: Command) {
  const allOptions = command.optsWithGlobals();
  const runPath = resolve(allOptions.repo || process.cwd());
  const manager = new CheckpointManager();

  if (!options.force) {
    getLogger().warn(text.cli.clearForcePrompt);
    return;
  }

  try {
    await manager.clearSnapshots(runPath);
    getLogger().success(text.cli.allSnapshotsCleared);
  } catch (error) {
    getLogger().error(
      text.cli.clearSnapshotsFailed(error instanceof Error ? error.message : String(error)),
    );
    process.exit(1);
  }
}
