import { resolve } from 'path';

import chalk from 'chalk';
import { Command } from 'commander';

import { CheckpointManager, logger } from '../../core/facades/cli-command-checkpoint.js';
import { text } from '../locales/index.js';

export async function handleSnapshotList(_options: any, command: Command) {
  const allOptions = command.optsWithGlobals();
  const runPath = resolve(allOptions.repo || process.cwd());
  const manager = new CheckpointManager();
  const snapshots = await manager.listSnapshots(runPath);

  if (snapshots.length === 0) {
    logger.log(text.cli.noSnapshots);
    return;
  }

  logger.log(chalk.bold(text.cli.availableSnapshots));
  logger.log(chalk.dim(text.cli.snapshotTableHead));

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
    logger.log(`${chalk.cyan(s.hash)}  ${chalk.gray(s.timestamp)}  ${displayMsg}`);
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
    logger.success(text.cli.snapshotCreated(result.commitHash));
    if (options.message) {
      logger.log(text.cli.snapshotMessage(options.message));
    }
  } catch (error) {
    logger.error(
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
    logger.log(chalk.bold(text.cli.snapshotDetails(hash)));

    if (details.stagedFiles.length > 0) {
      logger.log(chalk.green('\n' + text.cli.stagedFiles));
      details.stagedFiles.forEach((f) => logger.log(`  ${f}`));
    } else {
      logger.log(chalk.gray('\n' + text.cli.noStagedFiles));
    }

    if (details.unstagedFiles.length > 0) {
      logger.log(chalk.yellow('\n' + text.cli.unstagedChanges));
      details.unstagedFiles.forEach((f) => logger.log(`  ${f}`));
    } else {
      logger.log(chalk.gray('\n' + text.cli.noUnstagedChanges));
    }

    if (options.files) {
      logger.log(chalk.blue('\n' + text.cli.allFilesInSnapshot));
      const files = await manager.getSnapshotFiles(runPath, hash);
      files.forEach((f) => logger.log(`  ${f}`));
    }
  } catch (error) {
    logger.error(
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
      logger.log(text.cli.noDifferences);
    } else {
      process.stdout.write(diffOutput + '\n');
    }
  } catch (error) {
    logger.error(text.cli.getDiffFailed(error instanceof Error ? error.message : String(error)));
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
    logger.error(text.cli.readFileFailed(error instanceof Error ? error.message : String(error)));
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
    logger.info(text.cli.exportStarting(hash, targetDir));
    await manager.exportSnapshot(runPath, hash, targetDir);
    logger.success(text.cli.exportSuccess(hash));
  } catch (error) {
    logger.error(text.cli.exportFailed(error instanceof Error ? error.message : String(error)));
    process.exit(1);
  }
}

export async function handleSnapshotDelete(hash: string, _options: any, command: Command) {
  const allOptions = command.optsWithGlobals();
  const runPath = resolve(allOptions.repo || process.cwd());
  const manager = new CheckpointManager();

  try {
    await manager.deleteSnapshot(runPath, hash);
    logger.success(text.cli.snapshotDeleted(hash));
  } catch (error) {
    logger.error(
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
    logger.warn(text.cli.clearForcePrompt);
    return;
  }

  try {
    await manager.clearSnapshots(runPath);
    logger.success(text.cli.allSnapshotsCleared);
  } catch (error) {
    logger.error(
      text.cli.clearSnapshotsFailed(error instanceof Error ? error.message : String(error)),
    );
    process.exit(1);
  }
}
