import { subAgentTaskSpec } from '../../sub-agent/tools/task-spawn.js';
import { ToolRegistry } from '../registry.js';

import { artifactReadSpec, executeArtifactRead } from './artifact.js';
import { astGrepSpec, executeAstGrep } from './ast-grep.js';
import { astDefsRefsSpec, executeAstDefsRefs } from './ast.js';
import { codeSearchExecutor } from './code-search/executor.js';
import { CodeSearchSpec } from './code-search/spec.js';
import {
  codeReadSpec,
  executeFsList,
  executeFsReadFile,
  fsListSpec,
  fsReadFileSpec,
} from './fs.js';
import { gitCatSpec, executeGitCat, gitStatusSpec, executeGitStatus } from './git.js';
import { askUserSpec } from './interaction.js';
import { updateKnowledgeSpec, executeUpdateKnowledge } from './knowledge.js';
import { planInitSpec, planReadSpec, planUpdateSpec } from './plan.js';
import { proposalApplySpec, executeProposalApply } from './proposal.js';
import { shellExecSpec, executeShellExec } from './shell.js';
import { verifyRunSpec, executeVerifyRun } from './verify.js';

/**
 * Registers all builtin tools into the provided registry
 */
export function registerAllBuiltins(registry: ToolRegistry): void {
  // Register sub-agent tool
  registry.register(subAgentTaskSpec);
  registry.register({
    ...artifactReadSpec,
    executor: executeArtifactRead as any,
  });
  registry.register({
    ...updateKnowledgeSpec,
    executor: executeUpdateKnowledge as any,
  });
  registry.register({
    ...proposalApplySpec,
    executor: executeProposalApply as any,
  });
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
    ...codeReadSpec,
    executor: executeFsReadFile as any,
  });

  registry.register({
    ...fsListSpec,
    executor: executeFsList as any,
  });

  registry.register({
    ...astGrepSpec,
    executor: executeAstGrep as any,
  });

  registry.register({
    ...verifyRunSpec,
    executor: executeVerifyRun as any,
  });

  registry.register({
    ...shellExecSpec,
    executor: executeShellExec as any,
  });

  registry.register(planInitSpec);
  registry.register(planReadSpec);
  registry.register(planUpdateSpec);
  registry.register(askUserSpec);
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
  codeReadSpec,
  fsListSpec,
  executeFsList,
  fsReadFileSpec as fsReadSpec,
  executeFsReadFile as executeFsRead,
  updateKnowledgeSpec,
  executeUpdateKnowledge,
  astGrepSpec as codeSearchAstSpec,
  executeAstGrep as executeCodeSearchAst,
  verifyRunSpec as testRunSpec,
  executeVerifyRun as executeTestRun,
};
