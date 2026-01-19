import { RooSalmonAdapter } from './adapter.js';
import { OpenAILLM } from '../../index.js';

async function example() {
  const adapter = new RooSalmonAdapter();
  
  const result = await adapter.execute({
    instruction: 'Fix the typo in README.md',
    verify: 'npm test',
    repoPath: process.cwd(),
    llm: new OpenAILLM(),
    allowDirty: false
  }, (event) => {
    // Update UI based on event
    if (event.type === 'phase.start') {
      console.log(`UI: Now entering ${event.phase}...`);
    }
  });

  if (result.success) {
    console.log('UI: Success!');
  } else {
    console.error(`UI: Failed. Reason: ${result.reason}`);
  }
}
