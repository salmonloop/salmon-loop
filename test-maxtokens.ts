import { buildAiSdkRequestParams } from './src/core/llm/ai-sdk/request-params.js';

const params = {
  model: 'test-model',
  messages: [{ role: 'user', content: 'test' }],
  options: {
    maxTokens: 4096,
    temperature: 0,
  },
  headers: {},
  abortSignal: new AbortController().signal,
};

const result = buildAiSdkRequestParams(params);
console.log('Result:', JSON.stringify(result, null, 2));
console.log('maxOutputTokens type:', typeof result.maxOutputTokens);
console.log('maxOutputTokens value:', result.maxOutputTokens);