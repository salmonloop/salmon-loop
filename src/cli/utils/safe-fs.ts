import * as fsPromises from 'fs/promises';
import fs from 'node:fs';
import path from 'node:path';

import { ensureInSandbox, safeJoin } from '../../core/facades/cli-utils-path.js';

function resolvePath(targetPath: string, rootContext?: string): string {
  if (!rootContext) return targetPath;
  // Allow passing either absolute paths or paths relative to the root context.
  const candidate = targetPath.startsWith(rootContext)
    ? targetPath
    : safeJoin(rootContext, targetPath);
  ensureInSandbox(rootContext, candidate);
  return path.resolve(candidate);
}

async function resolveRealRoot(rootContext: string): Promise<string> {
  try {
    return await fsPromises.realpath(rootContext);
  } catch {
    return path.resolve(rootContext);
  }
}

function resolveRealRootSync(rootContext: string): string {
  try {
    return fs.realpathSync(rootContext);
  } catch {
    return path.resolve(rootContext);
  }
}

async function assertNoSymlinkEscape(resolvedPath: string, rootContext?: string): Promise<void> {
  if (!rootContext) return;
  const [realRoot, realTarget] = await Promise.all([
    resolveRealRoot(rootContext),
    fsPromises.realpath(resolvedPath),
  ]);
  ensureInSandbox(realRoot, realTarget);
}

function assertNoSymlinkEscapeSync(resolvedPath: string, rootContext?: string): void {
  if (!rootContext) return;
  const realRoot = resolveRealRootSync(rootContext);
  const realTarget = fs.realpathSync(resolvedPath);
  ensureInSandbox(realRoot, realTarget);
}

async function assertParentInSandbox(resolvedPath: string, rootContext?: string): Promise<void> {
  if (!rootContext) return;
  if (!fs.existsSync(rootContext)) return;
  const realRoot = await resolveRealRoot(rootContext);
  let current = path.dirname(resolvedPath);
  let depth = 0;
  while (depth < 40) {
    try {
      const realParent = await fsPromises.realpath(current);
      ensureInSandbox(realRoot, realParent);
      return;
    } catch (error: unknown) {
      if (error && typeof error === 'object' && 'code' in error && error.code !== 'ENOENT')
        throw error;
      const next = path.dirname(current);
      if (next === current) {
        throw error;
      }
      current = next;
      depth += 1;
    }
  }
  throw new Error(
    `Security Violation: Parent directory ascent exceeded limit for: ${resolvedPath}`,
  );
}

async function assertNotSymlink(resolvedPath: string): Promise<void> {
  try {
    const stats = await fsPromises.lstat(resolvedPath);
    if (stats.isSymbolicLink()) {
      throw new Error(`Security Violation: Refusing to follow symlink: ${resolvedPath}`);
    }
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return;
    throw error;
  }
}

export function existsSync(targetPath: string, rootContext?: string): boolean {
  try {
    const resolved = resolvePath(targetPath, rootContext);
    if (!fs.existsSync(resolved)) return false;
    assertNoSymlinkEscapeSync(resolved, rootContext);
    return true;
  } catch {
    return false;
  }
}

export async function stat(targetPath: string, rootContext?: string): Promise<fs.Stats> {
  const resolved = resolvePath(targetPath, rootContext);
  await assertNoSymlinkEscape(resolved, rootContext);
  return fsPromises.stat(resolved);
}

export function statSync(targetPath: string, rootContext?: string): fs.Stats {
  const resolved = resolvePath(targetPath, rootContext);
  assertNoSymlinkEscapeSync(resolved, rootContext);
  return fs.statSync(resolved);
}

export async function readdirDirents(dirPath: string, rootContext?: string): Promise<fs.Dirent[]> {
  const resolved = resolvePath(dirPath, rootContext);
  await assertNoSymlinkEscape(resolved, rootContext);
  return fsPromises.readdir(resolved, { withFileTypes: true });
}

export function readdirDirentsSync(dirPath: string, rootContext?: string): fs.Dirent[] {
  const resolved = resolvePath(dirPath, rootContext);
  assertNoSymlinkEscapeSync(resolved, rootContext);
  return fs.readdirSync(resolved, { withFileTypes: true });
}

export async function readdir(dirPath: string, rootContext?: string): Promise<string[]> {
  const resolved = resolvePath(dirPath, rootContext);
  await assertNoSymlinkEscape(resolved, rootContext);
  return fsPromises.readdir(resolved);
}

export async function readFileUtf8(targetPath: string, rootContext?: string): Promise<string> {
  const resolved = resolvePath(targetPath, rootContext);
  await assertNoSymlinkEscape(resolved, rootContext);
  return fsPromises.readFile(resolved, 'utf-8');
}

export function readFileUtf8Sync(targetPath: string, rootContext?: string): string {
  const resolved = resolvePath(targetPath, rootContext);
  assertNoSymlinkEscapeSync(resolved, rootContext);
  return fs.readFileSync(resolved, 'utf-8');
}

export async function mkdirp(dirPath: string, rootContext?: string): Promise<void> {
  const resolved = resolvePath(dirPath, rootContext);
  await assertParentInSandbox(resolved, rootContext);
  await fsPromises.mkdir(resolved, { recursive: true });
}

export async function unlink(targetPath: string, rootContext?: string): Promise<void> {
  const resolved = resolvePath(targetPath, rootContext);
  await assertParentInSandbox(resolved, rootContext);
  await fsPromises.unlink(resolved);
}

export async function writeFileUtf8(
  targetPath: string,
  content: string,
  rootContext?: string,
): Promise<void> {
  const resolved = resolvePath(targetPath, rootContext);
  await assertParentInSandbox(resolved, rootContext);
  await assertNotSymlink(resolved);
  await fsPromises.writeFile(resolved, content, 'utf-8');
}

export async function rename(
  fromPath: string,
  toPath: string,
  rootContext?: string,
): Promise<void> {
  const resolvedFrom = resolvePath(fromPath, rootContext);
  const resolvedTo = resolvePath(toPath, rootContext);
  await assertParentInSandbox(resolvedFrom, rootContext);
  await assertParentInSandbox(resolvedTo, rootContext);
  await fsPromises.rename(resolvedFrom, resolvedTo);
}

export async function copyFile(
  fromPath: string,
  toPath: string,
  rootContext?: string,
): Promise<void> {
  const resolvedFrom = resolvePath(fromPath, rootContext);
  const resolvedTo = resolvePath(toPath, rootContext);
  await assertNoSymlinkEscape(resolvedFrom, rootContext);
  await assertParentInSandbox(resolvedTo, rootContext);
  await assertNotSymlink(resolvedTo);
  await fsPromises.copyFile(resolvedFrom, resolvedTo);
}

export async function openFile(
  targetPath: string,
  flags: string,
  rootContext?: string,
): Promise<fs.promises.FileHandle> {
  const resolved = resolvePath(targetPath, rootContext);
  await assertParentInSandbox(resolved, rootContext);
  return fsPromises.open(resolved, flags);
}

export async function realpath(targetPath: string, rootContext?: string): Promise<string> {
  const resolved = resolvePath(targetPath, rootContext);
  const resolvedReal = await fsPromises.realpath(resolved);
  if (rootContext) {
    const realRoot = await resolveRealRoot(rootContext);
    ensureInSandbox(realRoot, resolvedReal);
  }
  return resolvedReal;
}

export function safePathJoin(root: string, ...parts: string[]): string {
  const joined = safeJoin(root, ...parts);
  ensureInSandbox(root, joined);
  return path.resolve(joined);
}
