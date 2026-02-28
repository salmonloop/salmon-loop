export function createCliTaskRunner(deps: {
  facade: {
    createTask: (input: {
      capability: string;
      request: { instruction: string };
    }) => Promise<unknown>;
  };
}) {
  return {
    async run(input: { capability: string; instruction: string }) {
      return deps.facade.createTask({
        capability: input.capability,
        request: { instruction: input.instruction },
      });
    },
  };
}
