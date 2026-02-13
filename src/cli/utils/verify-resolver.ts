import { logger } from '../../core/observability/logger.js';
import { text } from '../../locales/index.js';

import { autoDetectVerifyCommand } from './detectors/index.js';

/**
 * Resolves the verification command based on priority:
 * 1. CLI explicit disable (--no-verify) -> undefined
 * 2. CLI explicit command (--verify "cmd") -> "cmd"
 * 3. Config file command -> "cmd"
 * 4. Auto-detection -> "detected-cmd"
 */
export async function resolveVerifyOption(
  repoPath: string,
  cliVerify: string | boolean | undefined,
  configVerify: string | undefined,
): Promise<string | undefined> {
  // 1. Explicitly disabled via --no-verify
  // Commander sets options.verify to false when --no-verify is used
  if (cliVerify === false) {
    logger.debug(text.verify.explicitlyDisabled);
    return undefined;
  }

  // 2. Explicitly provided via CLI --verify "cmd"
  if (typeof cliVerify === 'string') {
    return cliVerify;
  }

  // 3. Provided via config file
  if (configVerify) {
    return configVerify;
  }

  // 4. Auto-detect
  const detected = await autoDetectVerifyCommand(repoPath);
  if (detected) {
    logger.info(text.verify.autoDetected(detected));
    return detected;
  }

  return undefined;
}
