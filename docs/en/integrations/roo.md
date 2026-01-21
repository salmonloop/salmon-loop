# Roo Code Integration

SalmonLoop provides a clean adapter for integration with Roo Code (or other VSCode-based AI agents).

## Integration Flow

1. **Import the Adapter**: Use the `RooSalmonAdapter` from the library.
2. **Configure LLM**: Provide an LLM instance (e.g., `OpenAILLM`).
3. **Handle Events**: Subscribe to `LoopEvent` to update the editor UI in real-time.
4. **Execute**: Call the `execute` method with instructions and verification commands.

## Example

```typescript
import { RooSalmonAdapter, OpenAILLM } from 'salmon-loop';

const adapter = new RooSalmonAdapter();

const result = await adapter.execute({
  instruction: 'Fix compilation error in src/main.ts',
  verify: 'npm run build',
  repoPath: '/path/to/repo',
  llm: new OpenAILLM()
}, (event) => {
  // Update VSCode status bar or output channel
  switch (event.type) {
    case 'phase.start':
      updateStatus(`SalmonLoop: ${event.phase}...`);
      break;
    case 'retry':
      showWarning(`Retrying... Attempt ${event.attempt}`);
      break;
  }
});
```

## Event Types

- `phase.start` / `phase.end`: Track the progress of the loop.
- `diff.meta`: Get the list of files that will be modified.
- `verify.result`: Get the output of the verification command.
- `retry`: Notified when a retry is triggered.
- `log`: General logging information.

## Safety

By default, the adapter will reject running on a dirty workspace unless `worktree` strategy is used. This prevents SalmonLoop from accidentally overwriting uncommitted user changes.
