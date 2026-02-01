import { codeSearchExecutor } from '../../../src/core/tools/builtin/code-search/executor.js';
import { CapabilityCtx } from '../../../src/core/tools/capability/types.js';

describe('Code Search Capability', () => {
  const mockCtx: CapabilityCtx = {
    repoRoot: '/mock/repo',
    platform: 'win32',
    phase: 'CONTEXT',
    attemptId: 1,
    dryRun: false,
    runner: {
      execFile: vi.fn(),
    },
    limits: {
      timeoutMs: 1000,
      maxOutputBytes: 1024,
    },
    audit: {
      event: vi.fn(),
    },
  };

  describe('Ripgrep Backend', () => {
    it('should include --fixed-strings when isRegex is false', async () => {
      const execSpy = vi.spyOn(mockCtx.runner, 'execFile').mockImplementation(async (cmd, args) => {
        if (args?.includes('--version')) {
          return { stdout: 'ripgrep 13.0.0', stderr: '', exitCode: 0, timedOut: false };
        }
        return { stdout: '', stderr: '', exitCode: 0, timedOut: false };
      });

      await codeSearchExecutor({ pattern: 'foo.*bar', maxMatches: 100, isRegex: false }, mockCtx);

      // Find the actual search call (not the version check)
      const searchCall = execSpy.mock.calls.find((call) => !call[1].includes('--version'));
      expect(searchCall![1]).toContain('--fixed-strings');
    });

    it('should NOT include --fixed-strings when isRegex is true', async () => {
      const execSpy = vi.spyOn(mockCtx.runner, 'execFile').mockImplementation(async (cmd, args) => {
        if (args?.includes('--version')) {
          return { stdout: 'ripgrep 13.0.0', stderr: '', exitCode: 0, timedOut: false };
        }
        return { stdout: '', stderr: '', exitCode: 0, timedOut: false };
      });

      await codeSearchExecutor({ pattern: 'foo.*bar', maxMatches: 100, isRegex: true }, mockCtx);

      const searchCall = execSpy.mock.calls.find((call) => !call[1].includes('--version'));
      expect(searchCall![1]).not.toContain('--fixed-strings');
    });
  });

  describe('PowerShell Backend (Fallback)', () => {
    it('should include -SimpleMatch and ForEach-Object array wrapper', async () => {
      // Mock rg failure to trigger ps fallback. Keep this resilient to call ordering:
      // - rg --version => exit 127
      // - powershell version check => exit 0
      // - powershell search => returns JSON array
      vi.spyOn(mockCtx.runner, 'execFile').mockImplementation(async (cmd, args) => {
        if (cmd === 'rg') {
          return { stdout: '', stderr: 'rg not found', exitCode: 127, timedOut: false };
        }

        if (cmd === 'powershell' && args?.some((a) => a.includes('$PSVersionTable'))) {
          return { stdout: '7', stderr: '', exitCode: 0, timedOut: false };
        }

        if (cmd === 'powershell') {
          return { stdout: '[]', stderr: '', exitCode: 0, timedOut: false };
        }

        return { stdout: '', stderr: '', exitCode: 1, timedOut: false };
      });

      await codeSearchExecutor({ pattern: 'foo', maxMatches: 100, isRegex: false }, mockCtx);

      // Find the actual search call for PowerShell
      const psCall = (mockCtx.runner.execFile as any).mock.calls.find(
        (call: any) =>
          call[0] === 'powershell' &&
          !call[1].some((arg: string) => arg.includes('$PSVersionTable')),
      );
      const psCommand = psCall[1][2];
      expect(psCommand).toContain('-SimpleMatch');
      expect(psCommand).toContain('ForEach-Object { ,$_ }');
    });
  });
});
