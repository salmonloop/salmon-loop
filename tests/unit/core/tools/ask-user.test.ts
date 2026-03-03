import { describe, expect, it } from 'bun:test';

describe('interaction.ask_user tool', () => {
  it('returns answers from the user input provider', async () => {
    const { askUserSpec } = await import('../../../../src/core/tools/builtin/interaction.js');

    const provider = {
      askUser: async (input: any) => ({
        questions: input.questions,
        answers: { 'Pick one': 'A' },
      }),
    };

    const output = await askUserSpec.executor(
      {
        questions: [
          {
            question: 'Pick one',
            header: 'Pick',
            options: [
              { label: 'A', description: 'First' },
              { label: 'B', description: 'Second' },
            ],
            multiSelect: false,
          },
        ],
      },
      {
        repoRoot: '/repo',
        attemptId: 1,
        dryRun: false,
        userInputProvider: provider,
        agentKind: 'primary',
      } as any,
    );

    expect(output.answers['Pick one']).toBe('A');
    expect(output.questions.length).toBe(1);
  });

  it('throws when no provider is available', async () => {
    const { askUserSpec } = await import('../../../../src/core/tools/builtin/interaction.js');

    await expect(
      askUserSpec.executor(
        {
          questions: [
            {
              question: 'Pick one',
              header: 'Pick',
              options: [
                { label: 'A', description: 'First' },
                { label: 'B', description: 'Second' },
              ],
              multiSelect: false,
            },
          ],
        },
        {
          repoRoot: '/repo',
          attemptId: 1,
          dryRun: false,
          agentKind: 'primary',
        } as any,
      ),
    ).rejects.toMatchObject({ code: 'ASK_USER_REQUIRED' });
  });

  it('rejects answers that do not match question options', async () => {
    const { askUserSpec } = await import('../../../../src/core/tools/builtin/interaction.js');

    const provider = {
      askUser: async (input: any) => ({
        questions: input.questions,
        answers: { 'Pick one': 'C' },
      }),
    };

    await expect(
      askUserSpec.executor(
        {
          questions: [
            {
              question: 'Pick one',
              header: 'Pick',
              options: [
                { label: 'A', description: 'First' },
                { label: 'B', description: 'Second' },
              ],
              multiSelect: false,
            },
          ],
        },
        {
          repoRoot: '/repo',
          attemptId: 1,
          dryRun: false,
          userInputProvider: provider,
          agentKind: 'primary',
        } as any,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_OUTPUT' });
  });
});
