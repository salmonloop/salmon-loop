import { logger } from '../../../core/observability/logger.js';
import type { VerboseLevel } from '../../../core/types/index.js';
import { text } from '../../locales/index.js';

export function resolveVerboseLevel(raw: unknown): VerboseLevel | undefined {
  if (raw === true) return 'basic';
  if (typeof raw === 'string') return raw as VerboseLevel;
  return undefined;
}

export function logRunVerboseSummary(params: {
  verboseLevel?: VerboseLevel;
  instruction: string;
  verify?: string;
  repoPath: string;
  file?: string;
  selection?: unknown[];
  allowedToolRules: string[];
  disallowedToolRules: string[];
  dryRun?: boolean;
  configPath?: string;
}) {
  if (!params.verboseLevel) return;

  logger.setVerbose(params.verboseLevel);
  logger.cyan(text.cli.runningWith);
  logger.log(text.cli.instruction(params.instruction));
  if (params.verify) {
    logger.log(text.cli.verify(params.verify));
  }
  logger.log(text.cli.repoPath(params.repoPath));
  if (params.file) logger.log(text.cli.contextFile(params.file));
  if (params.selection) logger.log(text.cli.contextSelection(params.selection.length));
  if (params.allowedToolRules.length > 0) {
    logger.log(text.cli.allowedTools(params.allowedToolRules.join(', ')));
  }
  if (params.disallowedToolRules.length > 0) {
    logger.log(text.cli.disallowedTools(params.disallowedToolRules.join(', ')));
  }
  if (params.dryRun) logger.warn(text.cli.dryRunEnabled);
  if (params.configPath) {
    logger.log(text.cli.configPath(params.configPath));
  }
}
