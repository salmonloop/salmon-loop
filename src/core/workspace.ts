import { RunOptions, ExecutionWorkspace } from './types'
import { logger } from './logger'
import { tmpdir } from 'os'
import { basename, join, normalize, relative } from 'path'
import { rm } from 'fs/promises'
import { randomBytes } from 'crypto'
import { runGit } from './checkpoint/worktree.js'

/**
 * WorkspaceManager - Manages execution workspace for different checkpoint strategies
 * 
 * Supports two strategies:
 * - 'direct': Operates directly on the repository
 * - 'worktree': Creates a temporary git worktree for isolated execution
 */
export class WorkspaceManager {
  /**
   * Setup execution workspace based on strategy
   * @param options RunOptions with optional strategy
   * @returns ExecutionWorkspace configuration
   */
  static async setup(options: RunOptions): Promise<ExecutionWorkspace> {
    const strategy = options.strategy || 'direct'

    if (strategy === 'worktree') {
      logger.info('Using worktree strategy for isolated execution')
      const baseRef = await runGit(options.repoPath, ['rev-parse', 'HEAD'])
      const repoName = basename(options.repoPath)
      const timestamp = Date.now()
      const random = randomBytes(4).toString('hex')
      const worktreePath = join(tmpdir(), `salmon-loop-wt/${repoName}/${timestamp}-${random}`)
      const tmpDir = normalize(tmpdir())
      const normalizedWorktreePath = normalize(worktreePath)
      if (!normalizedWorktreePath.startsWith(tmpDir)) {
        throw new Error('Worktree path must be in system temp directory')
      }
      if (!relative(options.repoPath, worktreePath).startsWith('..')) {
        throw new Error('Worktree path must not be inside repo path')
      }
      await runGit(options.repoPath, ['worktree', 'add', '--detach', worktreePath, baseRef])
      logger.debug(`Created worktree at: ${worktreePath}`)
      return {
        baseRepoPath: options.repoPath,
        workPath: worktreePath,
        strategy: 'worktree'
      }
    }

    // Default direct strategy
    logger.info('Using direct strategy for repository execution')
    return {
      baseRepoPath: options.repoPath,
      workPath: options.repoPath,
      strategy: 'direct'
    }
  }


  /**
   * Teardown execution workspace and clean up resources
   * @param workspace ExecutionWorkspace to teardown
   */
  static async teardown(workspace: ExecutionWorkspace): Promise<void> {
    if (workspace.strategy !== 'worktree') {
      logger.info(`Teardown workspace (strategy: ${workspace.strategy}) - no action needed`)
      return
    }
    if (workspace.workPath === workspace.baseRepoPath) {
      logger.warn('Worktree strategy requested but workPath equals baseRepoPath; skipping cleanup to avoid data loss')
      return
    }
    let removed = false
    try {
      const list = await runGit(workspace.baseRepoPath, ['worktree', 'list', '--porcelain'])
      if (list.includes(workspace.workPath)) {
        await runGit(workspace.baseRepoPath, ['worktree', 'remove', '--force', workspace.workPath])
        removed = true
        logger.debug(`Removed worktree: ${workspace.workPath}`)
      } else {
        logger.warn(`Worktree not found in git worktree list: ${workspace.workPath}`)
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      logger.warn(`git worktree remove failed for ${workspace.workPath}, falling back to filesystem removal: ${msg}`)
    }
    if (!removed) {
      const tmpDir = normalize(tmpdir())
      const normalizedWorktreePath = normalize(workspace.workPath)
      if (!normalizedWorktreePath.startsWith(tmpDir)) {
        throw new Error('Worktree path not in temp directory, refusing to delete')
      }
      await rm(workspace.workPath, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
      logger.debug(`Successfully cleaned up worktree directory via fs.rm: ${workspace.workPath}`)
    }
  }
}
