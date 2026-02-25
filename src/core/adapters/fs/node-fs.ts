import * as fs from 'fs';
import * as fsPromises from 'fs/promises';

export default fsPromises;
export const promises = fsPromises;
export const syncFs: typeof fs & typeof fsPromises = Object.assign({}, fs, fsPromises);

export const {
  access,
  appendFile,
  chmod,
  chown,
  copyFile,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  readlink,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  unlink,
  utimes,
  writeFile,
} = fsPromises;

export const { existsSync, readFileSync, realpathSync } = fs;
