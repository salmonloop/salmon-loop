import { RunOptions, ExecutionWorkspace, CheckpointStrategy } from './types'
import { spawn } from 'child_process'
import { logger } from './logger'
import { tmpdir } from 'os'
import { mkdtemp } from 'fs/promises'
import { join } from 'path'

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
      return {
        baseRepoPath: options.repoPath,
        workPath: await this.createWorktree(options.repoPath),
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
   * Create a temporary git worktree
   * @param repoPath Path to the base repository
   * @returns Path to the created worktree
   * @throws Error if worktree creation fails
   */
  private static async createWorktree(repoPath: string): Promise<string> {
    // Use system temp directory with random UUID to avoid conflicts
    const tempPrefix = join(tmpdir(), 'salmon-loop-wt-')
    const worktreePath = await mkdtemp(tempPrefix)

    return new Promise((resolve, reject) => {
      // Use --detach to avoid creating branches and specify HEAD explicitly
      const gitProcess = spawn('git', ['worktree', 'add', '--detach', worktreePath, 'HEAD'], {
        cwd: repoPath,
        stdio: ['pipe', 'pipe', 'pipe']
      })

      let stdout = ''
      let stderr = ''

      gitProcess.stdout.on('data', (data) => {
        stdout += data.toString()
      })

      gitProcess.stderr.on('data', (data) => {
        stderr += data.toString()
      })

      gitProcess.on('close', (code) => {
        if (code === 0) {
          logger.info(`Created worktree at ${worktreePath}`)
          resolve(worktreePath)
        } else {
          reject(new Error(`git worktree failed (${code}): ${stderr.trim()}`))
        }
      })

      gitProcess.on('error', (error) => {
        reject(new Error(`Git worktree process error: ${error.message}`))
      })
    })
  }

  /**
   * Teardown execution workspace and clean up resources
   * @param workspace ExecutionWorkspace to teardown
   */
  static async teardown(workspace: ExecutionWorkspace): Promise<void> {
    if (workspace.strategy === 'worktree') {
      // Path safety check - ensure worktree path starts with system temp directory
      if (!workspace.workPath.startsWith(tmpdir())) {
        logger.warn(`Invalid worktree path detected: ${workspace.workPath}`)
        return Promise.resolve()
      }
      
      logger.info(`Cleaning up worktree at ${workspace.workPath}`)
      
      return new Promise((resolve, reject) => {
        // Use --force to ensure we remove the worktree even if it contains modifications
        // This is a temporary workspace, so we don't care about preserving its dirty state
        const gitProcess = spawn('git', ['worktree', 'remove', '--force', workspace.workPath], {
          cwd: workspace.baseRepoPath,
          stdio: ['pipe', 'pipe', 'pipe']
        })

        let stderr = ''

        gitProcess.stderr.on('data', (data) => {
          stderr += data.toString()
        })

        gitProcess.on('close', (code) => {
          if (code === 0) {
            logger.info(`Successfully removed worktree`)
            resolve()
          } else {
            logger.warn(`Failed to remove worktree: ${stderr}`)
            // Don't reject - we want to continue even if cleanup fails
            resolve()
          }
        })

        gitProcess.on('error', (error) => {
          logger.warn(`Git worktree cleanup process error: ${error.message}`)
          resolve()
        })
      })
    }

    // Direct strategy requires no cleanup
    logger.info('Direct strategy - no cleanup required')
    return Promise.resolve()
  }
}
