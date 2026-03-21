import { beforeEach, describe, expect, it, mock } from 'bun:test';

const queryMock = mock();
const execMetaMock = mock();
const execMock = mock();
const checkIgnoreMock = mock();

const lstatMock = mock();
const statMock = mock();
const realpathMock = mock();

mock.module('../../../src/core/adapters/git/git-adapter.js', () => ({
  GitAdapter: mock().mockImplementation(() => ({
    query: queryMock,
    execMeta: execMetaMock,
    exec: execMock,
    checkIgnore: checkIgnoreMock,
  })),
}));

mock.module('../../../src/core/adapters/fs/node-fs.js', () => ({
  lstat: lstatMock,
  stat: statMock,
  realpath: realpathMock,
}));

async function loadModules() {
  const [{ CheckpointManager }, { WorkspaceSynchronizer }] = await Promise.all([
    import('../../../src/core/strata/checkpoint/manager.js'),
    import('../../../src/core/strata/runtime/synchronizer.js'),
  ]);
  return { CheckpointManager, WorkspaceSynchronizer };
}

describe('WorkspaceSynchronizer dependency projection detection', () => {
  beforeEach(() => {
    queryMock.mockReset();
    execMetaMock.mockReset();
    execMock.mockReset();
    checkIgnoreMock.mockReset();
    lstatMock.mockReset();
    statMock.mockReset();
    realpathMock.mockReset();

    queryMock.mockImplementation(async (args: string[]) => {
      if (args[0] === 'status') {
        return '?? node_modules/pkg/index.js\0?? src/app.ts\0';
      }
      return '';
    });
    statMock.mockResolvedValue({ size: 16 });
    lstatMock.mockResolvedValue({ isSymbolicLink: () => false });
  });

  it('filters dependency projection roots when realpath escapes the repository', async () => {
    realpathMock.mockImplementation(async (targetPath: string) => {
      if (targetPath === 'C:\\repo') {
        return 'C:\\repo';
      }
      if (targetPath === 'C:\\repo\\node_modules') {
        return 'C:\\cache\\deps\\node_modules';
      }
      throw Object.assign(new Error(`ENOENT: ${targetPath}`), { code: 'ENOENT' });
    });

    const { CheckpointManager, WorkspaceSynchronizer } = await loadModules();
    const synchronizer = new WorkspaceSynchronizer(new CheckpointManager());

    const changed = await synchronizer.getChangedPaths('C:\\repo');

    expect(changed).toEqual(['src/app.ts']);
    expect(statMock).toHaveBeenCalledTimes(1);
    expect(statMock).toHaveBeenCalledWith('C:\\repo\\src\\app.ts');
  });
});
