#!/usr/bin/env bun
// 1. MUST be the very first lines to force all chalk instances (even in node_modules)
// to use color support before they complete initialization.
process.env.FORCE_COLOR = '3';

import 'dotenv/config';

import { runCli } from './run-cli.js';

await runCli(process.argv);
