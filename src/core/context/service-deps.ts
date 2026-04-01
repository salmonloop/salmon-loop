import { DefaultPromptAssembler } from './assembly/default-prompt-assembler.js';
import type { PromptAssembler } from './assembly/prompt-assembler.js';
import { getPromptCachingManager, PromptCachingManager } from './cache/prompt-caching.js';
import { ArchitectureGatherer } from './gatherers/architecture-gatherer.js';
import { ArtifactGatherer } from './gatherers/artifact-gatherer.js';
import { AstGatherer } from './gatherers/ast-gatherer.js';
import { GhostDependencyGatherer } from './gatherers/ghost-dependency-gatherer.js';
import { GitDiffGatherer } from './gatherers/git-diff-gatherer.js';
import { GitHistoryGatherer } from './gatherers/git-history-gatherer.js';
import { KnowledgeGatherer } from './gatherers/knowledge-gatherer.js';
import { MetadataGatherer } from './gatherers/metadata-gatherer.js';
import { PrimaryTextGatherer } from './gatherers/primary-text-gatherer.js';
import { RipgrepGatherer } from './gatherers/ripgrep-gatherer.js';
import { TargetResolver } from './targeting/target-resolver.js';

export interface ContextServiceDeps {
  primaryTextGatherer: PrimaryTextGatherer;
  ripgrepGatherer: RipgrepGatherer;
  gitDiffGatherer: GitDiffGatherer;
  astGatherer: AstGatherer;
  metadataGatherer: MetadataGatherer;
  gitHistoryGatherer: GitHistoryGatherer;
  architectureGatherer: ArchitectureGatherer;
  knowledgeGatherer: KnowledgeGatherer;
  artifactGatherer: ArtifactGatherer;
  ghostDependencyGatherer: GhostDependencyGatherer;
  targetResolver: TargetResolver;
  assembler: PromptAssembler;
  promptCachingManager: PromptCachingManager;
}

export function defaultContextServiceDeps(): ContextServiceDeps {
  const ripgrepGatherer = new RipgrepGatherer();
  return {
    primaryTextGatherer: new PrimaryTextGatherer(),
    ripgrepGatherer,
    gitDiffGatherer: new GitDiffGatherer(),
    astGatherer: new AstGatherer(),
    metadataGatherer: new MetadataGatherer(),
    gitHistoryGatherer: new GitHistoryGatherer(),
    architectureGatherer: new ArchitectureGatherer(),
    knowledgeGatherer: new KnowledgeGatherer(),
    artifactGatherer: new ArtifactGatherer(),
    ghostDependencyGatherer: new GhostDependencyGatherer(ripgrepGatherer),
    targetResolver: new TargetResolver(),
    assembler: new DefaultPromptAssembler(),
    promptCachingManager: getPromptCachingManager(),
  };
}
