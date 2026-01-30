import { text } from '../../../locales/index.js';
import { GitAdapter } from '../../adapters/git/git-adapter.js';
import { DirectWriteWorker } from '../workers/direct-write-worker.js';
import { GitApplyWorker } from '../workers/git-apply-worker.js';
import { IMergeWorker } from '../workers/i-merge-worker.js';
import { MMThreeWayWorker } from '../workers/mm-three-way-worker.js';
import { OverwriteBinaryWorker } from '../workers/overwrite-binary-worker.js';
import { ThreeWayMergeWorker } from '../workers/three-way-merge-worker.js';
import { UnionMergeWorker } from '../workers/union-merge-worker.js';

export class WorkerFactory {
  private workers = new Map<string, IMergeWorker>();

  constructor(repoPath: string) {
    const git = new GitAdapter(repoPath);

    this.register('direct-write', new DirectWriteWorker());
    this.register('git-apply', new GitApplyWorker(repoPath));
    this.register('3way-standard', new ThreeWayMergeWorker(git));
    this.register('union-merge-safe', new UnionMergeWorker());
    this.register('3way-mm-advanced', new MMThreeWayWorker(git));
    this.register('overwrite-binary', new OverwriteBinaryWorker());
  }

  register(id: string, worker: IMergeWorker): void {
    this.workers.set(id, worker);
  }

  get(id: string): IMergeWorker {
    const worker = this.workers.get(id);
    if (!worker) {
      throw new Error(text.grizzco.errors.workerNotFound(id));
    }
    return worker;
  }
}
