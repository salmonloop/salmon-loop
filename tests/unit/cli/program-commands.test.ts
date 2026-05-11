import { describe, expect, it } from 'bun:test';
import { Command } from 'commander';


describe('registerProgramCommands', () => {
  it('registers autopilot as the default run act-mode', async () => {
    const { registerProgramCommands } = await import('../../../src/cli/program-commands.js');

    const program = new Command();
    registerProgramCommands(program);

    const runCommand = program.commands.find((command) => command.name() === 'run');
    const actModeOption = runCommand?.options.find((option) => option.long === '--act-mode');

    expect(actModeOption?.defaultValue).toBe('autopilot');
    expect(runCommand?.helpInformation()).toContain('(default: "autopilot")');
  });
});
