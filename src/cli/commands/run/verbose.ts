import { getLogger } from '../../../core/facades/cli-observability.js';
import type { VerboseLevel } from '../../../core/types/execution.js';
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

  getLogger().setVerbose(params.verboseLevel);
  getLogger().cyan(text.cli.runningWith);
  getLogger().log(text.cli.instruction(params.instruction));
  if (params.verify) {
    getLogger().log(text.cli.verify(params.verify));
  }
  getLogger().log(text.cli.repoPath(params.repoPath));
  if (params.file) getLogger().log(text.cli.contextFile(params.file));
  if (params.selection) getLogger().log(text.cli.contextSelection(params.selection.length));
  if (params.allowedToolRules.length > 0) {
    getLogger().log(text.cli.allowedTools(params.allowedToolRules.join(', ')));
  }
  if (params.disallowedToolRules.length > 0) {
    getLogger().log(text.cli.disallowedTools(params.disallowedToolRules.join(', ')));
  }
  if (params.dryRun) getLogger().warn(text.cli.dryRunEnabled);
  if (params.configPath) {
    getLogger().log(text.cli.configPath(params.configPath));
  }
}
