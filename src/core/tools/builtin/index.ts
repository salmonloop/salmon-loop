import { subAgentTaskSpec } from '../../sub-agent/tools/task-spawn.js';
import { ToolRegistry } from '../registry.js';

import { artifactReadSpec, executeArtifactRead } from './artifact.js';
import { astGrepSpec, executeAstGrep } from './ast-grep.js';
import { astDefsRefsSpec, executeAstDefsRefs } from './ast.js';
import {
  benchmarkReportSpec,
  executeBenchmarkReport,
  executeGitApplyCheck,
  executeGitDiffCheck,
  executeSweBenchGetReport,
  executeSweBenchLoadInstance,
  executeSweBenchSubmitPredictions,
  executeSweBenchWritePrediction,
  gitApplyCheckSpec,
  gitDiffCheckSpec,
  sweBenchGetReportSpec,
  sweBenchLoadInstanceSpec,
  sweBenchSubmitPredictionsSpec,
  sweBenchWritePredictionSpec,
} from './benchmark.js';
import { codeSearchExecutor } from './code-search/executor.js';
import { CodeSearchSpec } from './code-search/spec.js';
import {
  codeReadSpec,
  executeFsCreateDirectory,
  executeFsList,
  executeFsListDirectory,
  executeFsListFiles,
  executeFsReadFile,
  executeFsDeleteFile,
  executeFsWriteFile,
  fsCreateDirectorySpec,
  fsDeleteFileSpec,
  fsListSpec,
  fsListDirectorySpec,
  fsListFilesSpec,
  fsReadFileSpec,
  fsWriteFileSpec,
} from './fs.js';
import { gitCatSpec, executeGitCat, gitStatusSpec, executeGitStatus } from './git.js';
import { askUserSpec } from './interaction.js';
import { updateKnowledgeSpec, executeUpdateKnowledge } from './knowledge.js';
import { planInitSpec, planReadSpec, planUpdateSpec } from './plan.js';
import { proposalApplySpec, executeProposalApply } from './proposal.js';
import { shellExecSpec, executeShellExec } from './shell.js';
import { verifyRunSpec, executeVerifyRun } from './verify.js';
import { workspaceInfoSpec, executeWorkspaceInfo } from './workspace.js';

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
    ...workspaceInfoSpec,
    executor: executeWorkspaceInfo as any,
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
    ...gitDiffCheckSpec,
    executor: executeGitDiffCheck as any,
  });

  registry.register({
    ...gitApplyCheckSpec,
    executor: executeGitApplyCheck as any,
  });

  registry.register({
    ...benchmarkReportSpec,
    executor: executeBenchmarkReport as any,
  });

  registry.register({
    ...sweBenchLoadInstanceSpec,
    executor: executeSweBenchLoadInstance as any,
  });

  registry.register({
    ...sweBenchWritePredictionSpec,
    executor: executeSweBenchWritePrediction as any,
  });

  registry.register({
    ...sweBenchSubmitPredictionsSpec,
    executor: executeSweBenchSubmitPredictions as any,
  });

  registry.register({
    ...sweBenchGetReportSpec,
    executor: executeSweBenchGetReport as any,
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
    ...fsListDirectorySpec,
    executor: executeFsListDirectory as any,
  });

  registry.register({
    ...fsListFilesSpec,
    executor: executeFsListFiles as any,
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

  registry.register({
    ...fsWriteFileSpec,
    executor: executeFsWriteFile as any,
  });

  registry.register({
    ...fsCreateDirectorySpec,
    executor: executeFsCreateDirectory as any,
  });

  registry.register({
    ...fsDeleteFileSpec,
    executor: executeFsDeleteFile as any,
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
  gitDiffCheckSpec,
  executeGitDiffCheck,
  gitApplyCheckSpec,
  executeGitApplyCheck,
  benchmarkReportSpec,
  executeBenchmarkReport,
  sweBenchLoadInstanceSpec,
  executeSweBenchLoadInstance,
  sweBenchWritePredictionSpec,
  executeSweBenchWritePrediction,
  sweBenchSubmitPredictionsSpec,
  executeSweBenchSubmitPredictions,
  sweBenchGetReportSpec,
  executeSweBenchGetReport,
  workspaceInfoSpec,
  executeWorkspaceInfo,
};
