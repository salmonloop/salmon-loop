import { Diagnostic } from './types.js';
import { parseGenericOutput } from './parsers.js';
import { applyPatterns } from './patterns.js';

export * from './types.js';
export * from './parsers.js';
export * from './patterns.js';

export function generateFeedbackPrompt(diagnostics: Diagnostic[]): string {
  if (diagnostics.length === 0) return "";

  let prompt = "Critical Errors found during verification:\n";
  diagnostics.forEach((d, i) => {
    const location = d.line ? `${d.file}:${d.line}` : d.file;
    prompt += `${i + 1}. ${location} - [${d.source}] ${d.message}\n`;
    const suggestion = d.suggestion || applyPatterns(d.message);
    if (suggestion) {
      prompt += `   Suggestion: ${suggestion}\n`;
    }
  });
  return prompt;
}

export function refineFeedback(output: string): string {
  const diagnostics = parseGenericOutput(output);
  if (diagnostics.length > 0) {
    return generateFeedbackPrompt(diagnostics);
  }
  // Fallback: last 2000 chars
  return output.length > 2000 ? `...${output.slice(-2000)}` : output;
}
