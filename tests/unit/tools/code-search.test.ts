import { codeSearchExecutor } from '../../../src/core/tools/builtin/code-search/executor.js';
import type { ToolRuntimeCtx, ExecutionPhase } from '../../../src/core/tools/types.js';
import { captureAuditEvents } from '../../helpers/audit-assert.ts';
import { captureLoggerAudit, mock } from '../../helpers/bun-test-harness.ts';

describe('Code Search Capability', () => {
  describe('Ripgrep Backend', () => {
    it('should include --fixed-strings when isRegex is false', async () => {
      const mockRunner = {
        execFile: mock(async (cmd: string, args: string[]) => {
          if (args?.includes('--version')) {
            return { stdout: 'ripgrep 13.0.0', stderr: '', exitCode: 0, timedOut: false };
          }
          return { stdout: '', stderr: '', exitCode: 0, timedOut: false };
        }),
      };

      const ctx: ToolRuntimeCtx & { phase: ExecutionPhase; platform: string; runner: any } = {
        repoRoot: '/mock/repo',
        platform: 'win32',
        phase: 'CONTEXT',
        attemptId: 1,
        dryRun: false,
        runner: mockRunner,
      };

      await codeSearchExecutor({ pattern: 'foo.*bar', maxMatches: 100, isRegex: false }, ctx);

      const searchCall = mockRunner.execFile.mock.calls
        .filter((call: any) => !call[1].includes('--version'))
        .at(-1);
      expect(searchCall![1]).toContain('--fixed-strings');
    });

    it('should NOT include --fixed-strings when isRegex is true', async () => {
      const mockRunner = {
        execFile: mock(async (cmd: string, args: string[]) => {
          if (args?.includes('--version')) {
            return { stdout: 'ripgrep 13.0.0', stderr: '', exitCode: 0, timedOut: false };
          }
          return { stdout: '', stderr: '', exitCode: 0, timedOut: false };
        }),
      };

      const ctx: ToolRuntimeCtx & { phase: ExecutionPhase; platform: string; runner: any } = {
        repoRoot: '/mock/repo',
        platform: 'win32',
        phase: 'CONTEXT',
        attemptId: 1,
        dryRun: false,
        runner: mockRunner,
      };

      await codeSearchExecutor({ pattern: 'foo.*bar', maxMatches: 100, isRegex: true }, ctx);

      const searchCall = mockRunner.execFile.mock.calls
        .filter((call: any) => !call[1].includes('--version'))
        .at(-1);
      expect(searchCall![1]).not.toContain('--fixed-strings');
    });
  });

  describe('PowerShell Backend (Fallback)', () => {
    it('should include -SimpleMatch and ForEach-Object array wrapper', async () => {
      const mockRunner = {
        execFile: mock(async (cmd: string, args: string[]) => {
          if (cmd === 'rg') {
            return { stdout: '', stderr: 'rg not found', exitCode: 127, timedOut: false };
          }
          if (cmd === 'powershell' && args?.some((a: string) => a.includes('$PSVersionTable'))) {
            return { stdout: '7', stderr: '', exitCode: 0, timedOut: false };
          }
          if (cmd === 'powershell') {
            return { stdout: '[]', stderr: '', exitCode: 0, timedOut: false };
          }
          return { stdout: '', stderr: '', exitCode: 1, timedOut: false };
        }),
      };

      const ctx: ToolRuntimeCtx & { phase: ExecutionPhase; platform: string; runner: any } = {
        repoRoot: '/mock/repo',
        platform: 'win32',
        phase: 'CONTEXT',
        attemptId: 1,
        dryRun: false,
        runner: mockRunner,
      };

      await codeSearchExecutor({ pattern: 'foo', maxMatches: 100, isRegex: false }, ctx);

      const psCall = mockRunner.execFile.mock.calls.find(
        (call: any) =>
          call[0] === 'powershell' &&
          !call[1].some((arg: string) => arg.includes('$PSVersionTable')),
      );
      if (!psCall) throw new Error('PowerShell search call not found');
      const psCommand = psCall[1][2];
      expect(psCommand).toContain('-SimpleMatch');
      expect(psCommand).toContain('ForEach-Object { ,$_ }');
    });
  });

  it('captures audit events when backends fail then succeed', async () => {
    mock.module('../../../src/core/tools/builtin/code-search/backends/rg.js', () => ({
      rgBackend: {
        id: 'mock-rg',
        async isCompatible() {
          return true;
        },
        async run() {
          return {
            ok: false,
            code: 'NONZERO_EXIT',
            message: 'simulated failure',
            retryable: true,
          };
        },
      },
    }));

    mock.module('../../../src/core/tools/builtin/code-search/backends/powershell.js', () => ({
      psBackend: {
        id: 'mock-ps',
        async isCompatible() {
          return true;
        },
        async run() {
          return {
            ok: true,
            output: {
              matches: [],
              truncated: false,
              backend: 'mock-ps',
              stats: { hits: 0 },
            },
          };
        },
      },
    }));

    const ctx = {
      repoRoot: '/repo',
      worktreeRoot: '/repo',
      attemptId: 2,
      dryRun: true,
      phase: 'PLAN' as const,
      platform: 'win32',
      runner: {
        execFile: async () => ({ exitCode: 0, stdout: '[]', stderr: '', timedOut: false }),
      },
    };
    const { auditEntries } = await captureLoggerAudit(() =>
      codeSearchExecutor(
        { pattern: 'hello', maxMatches: 100, isRegex: false },
        ctx as ToolRuntimeCtx & { phase: 'PLAN' },
      ),
    );

    mock.restore();

    const backendAudits = auditEntries.filter((entry) => entry.action === 'code.search.backend');
    expect(backendAudits.length).toBeGreaterThanOrEqual(3);
  });

  it('records audit trail entries for backend attempts', async () => {
    mock.module('../../../src/core/tools/builtin/code-search/backends/rg.js', () => ({
      rgBackend: {
        id: 'mock-rg',
        async isCompatible() {
          return true;
        },
        async run() {
          return {
            ok: false,
            code: 'NONZERO_EXIT',
            message: 'simulated failure',
            retryable: true,
          };
        },
      },
    }));

    mock.module('../../../src/core/tools/builtin/code-search/backends/powershell.js', () => ({
      psBackend: {
        id: 'mock-ps',
        async isCompatible() {
          return true;
        },
        async run() {
          return {
            ok: true,
            output: {
              matches: [],
              truncated: false,
              backend: 'mock-ps',
              stats: { hits: 0 },
            },
          };
        },
      },
    }));

    const ctx: ToolRuntimeCtx & { phase: ExecutionPhase; platform: string; runner: any } = {
      repoRoot: '/repo',
      worktreeRoot: '/repo',
      attemptId: 3,
      dryRun: false,
      phase: 'PLAN',
      platform: 'win32',
      runner: {
        execFile: mock().mockResolvedValue({
          stdout: '',
          stderr: '',
          exitCode: 0,
          timedOut: false,
        }),
      },
    };

    const { events } = await captureAuditEvents(() =>
      codeSearchExecutor({ pattern: 'audit', maxMatches: 100, isRegex: false }, ctx),
    );

    mock.restore();

    const detailTypes = events
      .map((entry) => (entry.details as { type?: string }).type)
      .filter((type): type is string => Boolean(type));
    expect(detailTypes).toContain('tool.backend.start');
    expect(detailTypes).toContain('tool.backend.fail');
    expect(detailTypes).toContain('tool.backend.ok');
  });
});
