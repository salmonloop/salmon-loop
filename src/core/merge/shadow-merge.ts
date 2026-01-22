import { spawn } from 'child_process';
import { randomBytes } from 'crypto';
import { readFile, writeFile, mkdir, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';

import { text } from '../../locales/index.js';
import { runGit } from '../checkpoint/worktree.js';
import { logger } from '../logger.js';
import type { VerboseLevel } from '../types.js';

const BINARY_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.bmp',
  '.ico',
  '.webp',
  '.pdf',
  '.zip',
  '.gz',
  '.tgz',
  '.7z',
  '.rar',
  '.exe',
  '.dll',
  '.bin',
]);

export interface ShadowMergeEngineOptions {
  mainRepoPath: string;
  shadowWorktreePath: string;
  initialRef: string;
  latestRef: string;
  verbose?: VerboseLevel;
  maxFileBytes?: number;
  shouldAllowPath?: (
    path: string,
    contentSize?: number,
  ) => Promise<{ allowed: boolean; reason?: string }>;
}

export class ShadowMergeEngine {
  private readonly options: ShadowMergeEngineOptions;

  constructor(options: ShadowMergeEngineOptions) {
    this.options = options;
  }

  async apply(): Promise<void> {
    const { mainRepoPath, shadowWorktreePath, initialRef, latestRef } = this.options;
    const diffEntries = await this.getShadowDiffEntries(shadowWorktreePath, initialRef, latestRef);

    const operations: { type: 'A' | 'M' | 'D'; path: string }[] = [];
    for (const entry of diffEntries) {
      if (entry.status === 'R' || entry.status === 'C') {
        if (entry.oldPath) {
          operations.push({ type: 'D', path: entry.oldPath });
        }
        operations.push({ type: 'A', path: entry.path });
        continue;
      }
      if (entry.status === 'A' || entry.status === 'M' || entry.status === 'D') {
        operations.push({ type: entry.status, path: entry.path });
      }
    }

    if (operations.length === 0) {
      return;
    }

    const conflicts: string[] = [];
    const skipped: string[] = [];
    const maxFileBytes = this.options.maxFileBytes ?? 1024 * 1024;

    const logPatchPreview = (filePath: string, patchText: string) => {
      if (this.options.verbose !== 'extended') return;
      const lines = patchText.split(/\r?\n/);
      const hunks = lines.filter((line) => line.startsWith('@@')).slice(0, 4);
      const preview = lines.slice(0, 12).join('\n');
      logger.trace(
        text.loop.shadowDiffPreviewEngine(filePath, lines.length, hunks.join(' | ') || 'none'),
      );
      logger.trace(text.loop.shadowDiffPreviewFull(preview));
    };

    const logAppliedLocations = (filePath: string, patchText: string, content: Buffer) => {
      if (this.options.verbose !== 'extended') return;
      const additions = patchText
        .split(/\r?\n/)
        .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
        .map((line) => line.slice(1))
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .slice(0, 3);
      if (additions.length === 0) return;
      const lines = content.toString('utf8').split(/\r?\n/);
      const locations = additions.map((needle) => {
        const index = lines.findIndex((line) => line.includes(needle));
        return index >= 0 ? `${needle} @ ${index + 1}` : `${needle} @ not found`;
      });
      logger.trace(text.loop.appliedLineLocationsEngine(filePath, locations.join(' | ')));
    };

    for (const op of operations) {
      const policy = await this.shouldAllowPath(op.path);
      if (!policy.allowed) {
        skipped.push(`${op.path} (${policy.reason})`);
        continue;
      }

      // CRITICAL: Re-fetch status for EACH file operation to avoid race conditions
      // DO NOT reuse status from previous iterations or cache it outside the loop
      const status = await this.getStatusForPath(mainRepoPath, op.path);
      const hasUserChanges = status ? status.staged || status.unstaged || status.untracked : false;

      if (op.type === 'A') {
        const aiContent = await this.gitShowFile(shadowWorktreePath, latestRef, op.path);
        if (!aiContent) {
          skipped.push(`${op.path} (missing-ai)`);
          continue;
        }
        if (aiContent.length > maxFileBytes) {
          skipped.push(`${op.path} (size-limit)`);
          continue;
        }
        const allowAdd = await this.shouldAllowPath(op.path, aiContent.length);
        if (!allowAdd.allowed) {
          skipped.push(`${op.path} (${allowAdd.reason})`);
          continue;
        }
        if (await this.isBinaryPath(shadowWorktreePath, op.path, aiContent)) {
          skipped.push(`${op.path} (binary)`);
          continue;
        }

        if (hasUserChanges) {
          if (status?.staged && !status.unstaged && !status.untracked) {
            const ignored = await this.isIgnoredPath(mainRepoPath, op.path);
            if (ignored) {
              const userWorkingPath = path.join(mainRepoPath, ...op.path.split('/'));
              const userWorkingContent = await this.readFileBufferSafe(userWorkingPath);
              if (!userWorkingContent) {
                conflicts.push(op.path);
                continue;
              }
              const isBinary =
                (await this.isBinaryPath(mainRepoPath, op.path, userWorkingContent)) ||
                (await this.isBinaryPath(shadowWorktreePath, op.path, aiContent));
              if (isBinary) {
                skipped.push(`${op.path} (binary)`);
                continue;
              }
              const emptyBase = Buffer.alloc(0);
              logger.warn(text.loop.unionMergeWarning(op.path));
              const workingMerge = await this.mergeFileContents(
                mainRepoPath,
                emptyBase,
                userWorkingContent,
                aiContent,
                { union: true },
              );
              await writeFile(userWorkingPath, workingMerge.merged);
              if (workingMerge.conflict) {
                conflicts.push(op.path);
              }
              continue;
            }
          }

          conflicts.push(op.path);
          continue;
        }

        const destPath = path.join(mainRepoPath, ...op.path.split('/'));
        try {
          await mkdir(path.dirname(destPath), { recursive: true });
          await writeFile(destPath, aiContent);
        } catch (error) {
          const err = error as NodeJS.ErrnoException;
          if (err?.code === 'EISDIR' || err?.code === 'EEXIST' || err?.code === 'ENOTDIR') {
            conflicts.push(`${op.path} (fs-collision)`);
            continue;
          }
          throw error;
        }
        continue;
      }

      if (op.type === 'D') {
        if (hasUserChanges) {
          conflicts.push(op.path);
          continue;
        }
        const targetPath = path.join(mainRepoPath, ...op.path.split('/'));
        try {
          await unlink(targetPath);
        } catch (error) {
          const err = error as NodeJS.ErrnoException;
          if (err?.code !== 'ENOENT') {
            throw error;
          }
        }
        continue;
      }

      if (status?.untracked || status?.deleted) {
        conflicts.push(op.path);
        continue;
      }

      const baseContent = await this.gitShowFile(shadowWorktreePath, initialRef, op.path);
      const aiContent = await this.gitShowFile(shadowWorktreePath, latestRef, op.path);
      if (!baseContent || !aiContent) {
        conflicts.push(op.path);
        continue;
      }
      const aiDiffPatch = await runGit(shadowWorktreePath, [
        'diff',
        '-U3',
        '--no-color',
        '--no-ext-diff',
        initialRef,
        latestRef,
        '--',
        op.path,
      ]);
      if (aiDiffPatch.trim()) {
        logPatchPreview(op.path, aiDiffPatch);
      }
      if (aiContent.length > maxFileBytes) {
        skipped.push(`${op.path} (size-limit)`);
        continue;
      }
      const allowModify = await this.shouldAllowPath(op.path, aiContent.length);
      if (!allowModify.allowed) {
        skipped.push(`${op.path} (${allowModify.reason})`);
        continue;
      }

      const userWorkingPath = path.join(mainRepoPath, ...op.path.split('/'));

      let userWorkingContent = await this.readFileBufferSafe(userWorkingPath);
      if (!userWorkingContent) {
        conflicts.push(op.path);
        continue;
      }

      const isBinary =
        (await this.isBinaryPath(shadowWorktreePath, op.path, aiContent)) ||
        (await this.isBinaryPath(mainRepoPath, op.path, userWorkingContent));
      if (isBinary) {
        skipped.push(`${op.path} (binary)`);
        continue;
      }

      const workingMerge = await this.mergeFileContents(
        mainRepoPath,
        baseContent,
        userWorkingContent,
        aiContent,
      );
      await writeFile(userWorkingPath, workingMerge.merged);
      if (workingMerge.conflict) {
        conflicts.push(op.path);
      }
      userWorkingContent = workingMerge.merged;
      logAppliedLocations(op.path, aiDiffPatch, userWorkingContent);

      if (status?.staged) {
        if (this.options.verbose === 'extended') {
          logger.trace(
            `[applyBack] File ${op.path} has staged changes in main workspace.\n` +
              `  Status: staged=${status.staged}, unstaged=${status.unstaged}, untracked=${status.untracked}`,
          );
        }

        const userStagedContent = await this.gitShowIndexFile(mainRepoPath, op.path);
        if (!userStagedContent) {
          conflicts.push(op.path);
          continue;
        }

        if (this.options.verbose === 'extended') {
          const stagedLines = userStagedContent.toString('utf8').split(/\r?\n/).length;
          logger.trace(
            `[applyBack] Staged version: ${stagedLines} lines, ${userStagedContent.length} bytes`,
          );
        }

        const stagedMerge = await this.mergeFileContents(
          mainRepoPath,
          baseContent,
          userStagedContent,
          aiContent,
        );
        if (!stagedMerge.conflict) {
          await this.updateIndexWithContent(mainRepoPath, op.path, stagedMerge.merged);
        } else {
          if (this.options.verbose === 'extended') {
            logger.trace(
              `[applyBack] Staged merge failed for ${op.path}. ` +
                `This likely indicates the staged version is out of sync with the working tree.`,
            );
          }
          conflicts.push(op.path);
        }
      }
    }

    if (skipped.length > 0) {
      logger.warn(text.loop.skippedFiles(skipped.join(', ')));
    }

    if (conflicts.length > 0) {
      throw new Error(
        `Apply-back completed with conflicts in ${conflicts.length} file(s): ${conflicts.join(', ')}`,
      );
    }
  }

  private normalizePath(value: string): string {
    return value.replace(/\\/g, '/');
  }

  private async shouldAllowPath(
    relativePath: string,
    contentSize?: number,
  ): Promise<{ allowed: boolean; reason?: string }> {
    if (!this.options.shouldAllowPath) return { allowed: true };
    return this.options.shouldAllowPath(relativePath, contentSize);
  }

  private hasBinarySignature(content: Buffer): boolean {
    for (let i = 0; i < content.length; i += 1) {
      if (content[i] === 0) return true;
    }
    return false;
  }

  private async isBinaryPath(
    repoPath: string,
    relativePath: string,
    content?: Buffer,
  ): Promise<boolean> {
    const ext = path.extname(relativePath).toLowerCase();
    if (BINARY_EXTENSIONS.has(ext)) return true;
    if (content) return this.hasBinarySignature(content);
    try {
      const filePath = path.join(repoPath, ...relativePath.split('/'));
      const buffer = await readFile(filePath);
      return this.hasBinarySignature(buffer.subarray(0, 8192));
    } catch {
      return false;
    }
  }

  private async isIgnoredPath(repoPath: string, relativePath: string): Promise<boolean> {
    const normalized = this.normalizePath(relativePath);
    const result = await this.runGitBuffered(
      repoPath,
      ['check-ignore', '--no-index', '--stdin'],
      Buffer.from(`${normalized}\n`, 'utf8'),
    );
    return result.code === 0;
  }

  private async runGitBuffered(
    repoPath: string,
    args: string[],
    input?: Buffer,
  ): Promise<{ stdout: Buffer; code: number }> {
    return new Promise((resolve, reject) => {
      const child = spawn('git', args, { cwd: repoPath, stdio: ['pipe', 'pipe', 'pipe'] });
      const chunks: Buffer[] = [];
      const errors: Buffer[] = [];

      child.stdout.on('data', (data) => chunks.push(Buffer.from(data)));
      child.stderr.on('data', (data) => errors.push(Buffer.from(data)));

      child.on('error', (err) => {
        reject(err);
      });

      child.on('close', (code) => {
        if (code === null) {
          reject(new Error('git command failed with unknown exit code'));
          return;
        }
        resolve({ stdout: Buffer.concat(chunks), code });
      });

      if (input) {
        child.stdin.write(input);
      }
      child.stdin.end();
    });
  }

  private async gitShowFile(
    repoPath: string,
    ref: string,
    relativePath: string,
  ): Promise<Buffer | null> {
    const spec = `${ref}:${this.normalizePath(relativePath)}`;
    const result = await this.runGitBuffered(repoPath, ['show', spec]);
    if (result.code !== 0) {
      return null;
    }
    return result.stdout;
  }

  private async gitShowIndexFile(repoPath: string, relativePath: string): Promise<Buffer | null> {
    const spec = `:${this.normalizePath(relativePath)}`;
    const result = await this.runGitBuffered(repoPath, ['show', spec]);
    if (result.code !== 0) {
      return null;
    }
    return result.stdout;
  }

  private async mergeFileContents(
    repoPath: string,
    baseContent: Buffer,
    userContent: Buffer,
    aiContent: Buffer,
    options: { union?: boolean } = {},
  ): Promise<{ merged: Buffer; conflict: boolean }> {
    // Diagnostic logging for 3-way merge inputs
    if (this.options.verbose === 'extended') {
      const baseLines = baseContent.toString('utf8').split(/\r?\n/).length;
      const userLines = userContent.toString('utf8').split(/\r?\n/).length;
      const aiLines = aiContent.toString('utf8').split(/\r?\n/).length;

      logger.trace(
        `[applyBack] 3-way merge input line counts:\n` +
          `  Base (initialRef): ${baseLines} lines, ${baseContent.length} bytes\n` +
          `  User (working):    ${userLines} lines, ${userContent.length} bytes\n` +
          `  AI (latestRef):    ${aiLines} lines, ${aiContent.length} bytes`,
      );
    }

    const normalized = this.normalizeLineEndingsForMerge(baseContent, userContent, aiContent);
    const basePath = path.join(
      tmpdir(),
      `salmon-loop-merge-base-${randomBytes(4).toString('hex')}`,
    );
    const userPath = path.join(
      tmpdir(),
      `salmon-loop-merge-user-${randomBytes(4).toString('hex')}`,
    );
    const aiPath = path.join(tmpdir(), `salmon-loop-merge-ai-${randomBytes(4).toString('hex')}`);

    await writeFile(basePath, normalized.base);
    await writeFile(userPath, normalized.user);
    await writeFile(aiPath, normalized.ai);

    try {
      const args = ['merge-file', '-p'];
      if (options.union) {
        args.push('--union');
      }
      args.push(userPath, basePath, aiPath);
      const result = await this.runGitBuffered(repoPath, args);
      if (result.code === 0) {
        return {
          merged: this.restoreLineEndings(result.stdout, normalized.preferredLineEnding),
          conflict: false,
        };
      }
      if (result.code === 1) {
        return {
          merged: this.restoreLineEndings(result.stdout, normalized.preferredLineEnding),
          conflict: true,
        };
      }
      throw new Error(`git merge-file failed with code ${result.code}`);
    } finally {
      try {
        await unlink(basePath);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.warn(text.loop.removeMergeTempFailed(basePath, msg));
      }
      try {
        await unlink(userPath);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.warn(text.loop.removeMergeTempFailed(userPath, msg));
      }
      try {
        await unlink(aiPath);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.warn(text.loop.removeMergeTempFailed(aiPath, msg));
      }
    }
  }

  private normalizeLineEndingsForMerge(
    baseContent: Buffer,
    userContent: Buffer,
    aiContent: Buffer,
  ): {
    base: Buffer;
    user: Buffer;
    ai: Buffer;
    preferredLineEnding: '\n' | '\r\n' | null;
  } {
    const userText = userContent.toString('utf8');
    const hasCrlf = /\r\n/.test(userText);
    const hasBareLf = /(^|[^\r])\n/.test(userText);
    if (!hasCrlf || hasBareLf) {
      return { base: baseContent, user: userContent, ai: aiContent, preferredLineEnding: null };
    }

    const toLf = (text: string) => text.replace(/\r\n/g, '\n');
    if (this.options.verbose === 'extended') {
      logger.trace(text.loop.normalizingCrlf);
    }
    return {
      base: Buffer.from(toLf(baseContent.toString('utf8')), 'utf8'),
      user: Buffer.from(toLf(userText), 'utf8'),
      ai: Buffer.from(toLf(aiContent.toString('utf8')), 'utf8'),
      preferredLineEnding: '\r\n',
    };
  }

  private restoreLineEndings(content: Buffer, lineEnding: '\n' | '\r\n' | null): Buffer {
    if (!lineEnding || lineEnding === '\n') {
      return content;
    }
    const text = content.toString('utf8').replace(/\r\n/g, '\n');
    return Buffer.from(text.replace(/\n/g, lineEnding), 'utf8');
  }

  private async hashObject(repoPath: string, content: Buffer): Promise<string> {
    const result = await this.runGitBuffered(repoPath, ['hash-object', '-w', '--stdin'], content);
    return result.stdout.toString().trim();
  }

  private async getIndexMode(repoPath: string, relativePath: string): Promise<string | null> {
    try {
      const output = await runGit(repoPath, ['ls-files', '-s', '--', relativePath]);
      if (!output.trim()) return null;
      const parts = output.trim().split(/\s+/);
      return parts[0] || null;
    } catch {
      return null;
    }
  }

  private async updateIndexWithContent(
    repoPath: string,
    relativePath: string,
    content: Buffer,
  ): Promise<void> {
    const mode = (await this.getIndexMode(repoPath, relativePath)) || '100644';
    const hash = await this.hashObject(repoPath, content);
    await runGit(repoPath, ['update-index', '--cacheinfo', mode, hash, relativePath]);
  }

  private async readFileBufferSafe(filePath: string): Promise<Buffer | null> {
    try {
      return await readFile(filePath);
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err?.code === 'ENOENT') return null;
      throw error;
    }
  }

  private async getStatusForPath(
    repoPath: string,
    relativePath: string,
  ): Promise<{ staged: boolean; unstaged: boolean; untracked: boolean; deleted: boolean } | null> {
    const status = await runGit(repoPath, ['status', '--porcelain', '-z', '--', relativePath]);
    if (!status) return null;

    const tokens = status.split('\0').filter((token) => token.length > 0);

    if (this.options.verbose === 'extended' && tokens.length > 0) {
      logger.trace(text.loop.getStatusForPathRaw(relativePath));
      tokens.forEach((token, idx) => {
        const code = token.slice(0, 2);
        logger.trace(
          text.loop.getStatusForPathToken(
            idx,
            code,
            Buffer.from(code[0] || '').toString('hex'),
            Buffer.from(code[1] || '').toString('hex'),
            token,
          ),
        );
      });
    }
    const result = new Map<
      string,
      { staged: boolean; unstaged: boolean; untracked: boolean; deleted: boolean }
    >();
    const extractPath = (entry: string): string => {
      if (entry.length <= 2) return '';
      const maybeSep = entry[2];
      if (maybeSep === ' ' || maybeSep === '\t') {
        return entry.slice(3);
      }
      return entry.slice(2);
    };
    for (let i = 0; i < tokens.length; i += 1) {
      const entry = tokens[i];
      const code = entry.slice(0, 2);
      const pathPart = extractPath(entry);
      if (!pathPart) continue;

      if (code.startsWith('R') || code.startsWith('C')) {
        const original = pathPart;
        const renamed = tokens[i + 1];
        if (original) {
          result.set(this.normalizePath(original), {
            staged: true,
            unstaged: false,
            untracked: false,
            deleted: false,
          });
        }
        if (renamed) {
          result.set(this.normalizePath(renamed), {
            staged: true,
            unstaged: false,
            untracked: false,
            deleted: false,
          });
        }
        i += 1;
        continue;
      }

      const staged = code[0] !== ' ' && code[0] !== '?';
      const unstaged = code[1] !== ' ';
      const untracked = code === '??';
      const deleted = code.includes('D');
      const normalizedPath = this.normalizePath(pathPart);
      const existing = result.get(normalizedPath);
      if (existing) {
        result.set(normalizedPath, {
          staged: existing.staged || staged,
          unstaged: existing.unstaged || unstaged,
          untracked: existing.untracked || untracked,
          deleted: existing.deleted || deleted,
        });
      } else {
        result.set(normalizedPath, { staged, unstaged, untracked, deleted });
      }
    }
    return result.get(this.normalizePath(relativePath)) || null;
  }

  private async getShadowDiffEntries(
    worktreePath: string,
    initialRef: string,
    latestRef: string,
  ): Promise<{ status: string; path: string; oldPath?: string }[]> {
    const output = await runGit(worktreePath, [
      'diff',
      '--name-status',
      '-z',
      initialRef,
      latestRef,
    ]);
    if (!output) return [];
    const tokens = output.split('\0').filter((token) => token.length > 0);
    const entries: { status: string; path: string; oldPath?: string }[] = [];
    for (let i = 0; i < tokens.length; i += 1) {
      const statusToken = tokens[i];
      const status = statusToken.charAt(0);
      if (status === 'R' || status === 'C') {
        const oldPath = tokens[i + 1];
        const newPath = tokens[i + 2];
        if (oldPath && newPath) {
          entries.push({
            status,
            path: this.normalizePath(newPath),
            oldPath: this.normalizePath(oldPath),
          });
        }
        i += 2;
        continue;
      }
      const pathToken = tokens[i + 1];
      if (pathToken) {
        entries.push({ status, path: this.normalizePath(pathToken) });
      }
      i += 1;
    }
    return entries;
  }
}
