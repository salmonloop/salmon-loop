import { ToolRegistry } from '../registry.js';

import { astGrepSpec, executeAstGrep } from './ast-grep.js';
import { astDefsRefsSpec, executeAstDefsRefs } from './ast.js';
import { codeSearchExecutor } from './code-search/executor.js';
import { CodeSearchSpec } from './code-search/spec.js';
import { fsReadFileSpec, executeFsReadFile } from './fs.js';
import { gitCatSpec, executeGitCat, gitStatusSpec, executeGitStatus } from './git.js';
import { verifyRunSpec, executeVerifyRun } from './verify.js';

/**
 * Registers all builtin tools into the provided registry
 */
export function registerAllBuiltins(registry: ToolRegistry): void {
  // Register unified code.search with its specific executor
  registry.register({
    ...CodeSearchSpec,
    executor: codeSearchExecutor as any,
  });

  registry.register({
    ...astDefsRefsSpec,
    executor: executeAstDefsRefs as any,
  });

  registry.register({
    ...gitCatSpec,
    executor: executeGitCat as any,
  });

  registry.register({
    ...gitStatusSpec,
    executor: executeGitStatus as any,
  });

  registry.register({
    ...fsReadFileSpec,
    executor: executeFsReadFile as any,
  });

  registry.register({
    ...astGrepSpec,
    executor: executeAstGrep as any,
  });

  registry.register({
    ...verifyRunSpec,
    executor: executeVerifyRun as any,
  });
}

export {
  CodeSearchSpec,
  codeSearchExecutor,
  astDefsRefsSpec as codeAstSpec,
  executeAstDefsRefs as executeCodeAst,
  gitCatSpec,
  executeGitCat,
  gitStatusSpec,
  executeGitStatus,
  fsReadFileSpec as fsReadSpec,
  executeFsReadFile as executeFsRead,
  astGrepSpec as codeSearchAstSpec,
  executeAstGrep as executeCodeSearchAst,
  verifyRunSpec as testRunSpec,
  executeVerifyRun as executeTestRun,
};
