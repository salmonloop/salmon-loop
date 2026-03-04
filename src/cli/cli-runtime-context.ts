import type { Command } from 'commander';

import {
  detectHeadlessOutputFromArgv,
  type DetectedHeadlessOutput,
} from './argv/headless-detection.js';
import { rewriteArgvForPrintMode } from './argv/print-mode.js';

export interface CliRuntimeContext {
  program: Command;
  rewrittenArgv: string[];
  headlessDetection: DetectedHeadlessOutput;
}

export function createCliRuntimeContext(program: Command, rawArgv: string[]): CliRuntimeContext {
  const rewrittenArgv = rewriteArgvForPrintMode(rawArgv);
  const headlessDetection = detectHeadlessOutputFromArgv(rewrittenArgv);
  return {
    program,
    rewrittenArgv,
    headlessDetection,
  };
}
