import { agentAwaitTaskSpec } from '../../sub-agent/tools/task-await.js';
import { subAgentTaskSpec } from '../../sub-agent/tools/task-spawn.js';
import { agentTeamSpec } from '../../sub-agent/tools/team.js';
import { ToolRegistry } from '../registry.js';
import { defineTool } from '../types.js';

import { artifactReadSpec, executeArtifactRead } from './artifact.js';
import { astGrepSpec, executeAstGrep } from './ast-grep.js';
import {
  astDefsRefsSpec,
  executeAstDefsRefs,
  codeFindReferencesSpec,
  executeCodeFindReferences,
} from './ast.js';
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
  executeFsEditFile,
  executeFsList,
  executeFsListDirectory,
  executeFsListFiles,
  executeFsReadFile,
  executeFsDeleteFile,
  executeFsWriteFile,
  fsCreateDirectorySpec,
  fsDeleteFileSpec,
  fsEditFileSpec,
  fsListSpec,
  fsListDirectorySpec,
  fsListFilesSpec,
  fsReadFileSpec,
  fsWriteFileSpec,
} from './fs.js';
import {
  gitCatSpec,
  executeGitCat,
  gitStatusSpec,
  executeGitStatus,
  gitBlameSpec,
  executeGitBlame,
  gitLogSpec,
  executeGitLog,
  gitShowSpec,
  executeGitShow,
} from './git.js';
import { globFindSpec, executeGlobFind } from './glob.js';
import { askUserSpec } from './interaction.js';
import { updateKnowledgeSpec, executeUpdateKnowledge } from './knowledge.js';
import { planInitSpec, planReadSpec, planUpdateSpec } from './plan.js';
import { proposalApplySpec, executeProposalApply } from './proposal.js';
import { shellExecSpec, executeShellExec } from './shell.js';
import { verifyRunSpec, executeVerifyRun } from './verify.js';
import { workspaceInfoSpec, executeWorkspaceInfo } from './workspace.js';

/**
 * Registers all builtin tools into the provided registry.
 * Uses defineTool() to pair specs with executors type-safely.
 */
export function registerAllBuiltins(registry: ToolRegistry): void {
  // Sub-agent tools (already self-contained)
  registry.register(subAgentTaskSpec);
  registry.register(agentAwaitTaskSpec);
  registry.register(agentTeamSpec);

  // Artifact & knowledge
  registry.register(defineTool(artifactReadSpec, executeArtifactRead));
  registry.register(defineTool(updateKnowledgeSpec, executeUpdateKnowledge));
  registry.register(defineTool(workspaceInfoSpec, executeWorkspaceInfo));
  registry.register(defineTool(proposalApplySpec, executeProposalApply));

  // Code search & AST
  registry.register(defineTool(CodeSearchSpec, codeSearchExecutor));
  registry.register(defineTool(astDefsRefsSpec, executeAstDefsRefs));
  registry.register(defineTool(codeFindReferencesSpec, executeCodeFindReferences));
  registry.register(defineTool(astGrepSpec, executeAstGrep));

  // Git
  registry.register(defineTool(gitCatSpec, executeGitCat));
  registry.register(defineTool(gitStatusSpec, executeGitStatus));
  registry.register(defineTool(gitBlameSpec, executeGitBlame));
  registry.register(defineTool(gitLogSpec, executeGitLog));
  registry.register(defineTool(gitShowSpec, executeGitShow));
  registry.register(defineTool(gitDiffCheckSpec, executeGitDiffCheck));
  registry.register(defineTool(gitApplyCheckSpec, executeGitApplyCheck));

  // Glob
  registry.register(defineTool(globFindSpec, executeGlobFind));

  // Benchmark / SWE-bench
  registry.register(defineTool(benchmarkReportSpec, executeBenchmarkReport));
  registry.register(defineTool(sweBenchLoadInstanceSpec, executeSweBenchLoadInstance));
  registry.register(defineTool(sweBenchWritePredictionSpec, executeSweBenchWritePrediction));
  registry.register(defineTool(sweBenchSubmitPredictionsSpec, executeSweBenchSubmitPredictions));
  registry.register(defineTool(sweBenchGetReportSpec, executeSweBenchGetReport));

  // Filesystem
  registry.register(defineTool(fsReadFileSpec, executeFsReadFile));
  registry.register(defineTool(codeReadSpec, executeFsReadFile));
  registry.register(defineTool(fsListSpec, executeFsList));
  registry.register(defineTool(fsListDirectorySpec, executeFsListDirectory));
  registry.register(defineTool(fsListFilesSpec, executeFsListFiles));
  registry.register(defineTool(fsWriteFileSpec, executeFsWriteFile));
  registry.register(defineTool(fsEditFileSpec, executeFsEditFile));
  registry.register(defineTool(fsCreateDirectorySpec, executeFsCreateDirectory));
  registry.register(defineTool(fsDeleteFileSpec, executeFsDeleteFile));

  // Execution
  registry.register(defineTool(verifyRunSpec, executeVerifyRun));
  registry.register(defineTool(shellExecSpec, executeShellExec));

  // Plan & interaction
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
  codeFindReferencesSpec,
  executeCodeFindReferences,
  gitCatSpec,
  executeGitCat,
  gitStatusSpec,
  executeGitStatus,
  gitBlameSpec,
  executeGitBlame,
  gitLogSpec,
  executeGitLog,
  gitShowSpec,
  executeGitShow,
  globFindSpec,
  executeGlobFind,
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
