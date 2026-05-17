#!/usr/bin/env bun
import {
  detectHeadlessOutputFromArgv,
  shouldForceColorForArgv,
} from './argv/headless-detection.js';

const headlessOutput = Boolean(detectHeadlessOutputFromArgv(process.argv).outputFormat);
if (!headlessOutput && shouldForceColorForArgv(process.argv)) {
  process.env.FORCE_COLOR = '3';
}

import 'dotenv/config';

const { runCli } = await import('./run-cli.js');

await runCli(process.argv);
