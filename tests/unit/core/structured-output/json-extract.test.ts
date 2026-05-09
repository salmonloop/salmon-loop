import { describe, test, expect } from 'bun:test';

import { extractFirstJsonValueFromText } from '../../../../src/core/structured-output/json-extract.js';

describe('extractFirstJsonValueFromText', () => {
  test('returns null for empty or missing text', () => {
    expect(extractFirstJsonValueFromText('')).toBeNull();
    // @ts-expect-error testing invalid input
    expect(extractFirstJsonValueFromText(null)).toBeNull();
    // @ts-expect-error testing invalid input
    expect(extractFirstJsonValueFromText(undefined)).toBeNull();
  });

  test('returns null when no JSON start characters are found', () => {
    expect(extractFirstJsonValueFromText('just some text with no brackets')).toBeNull();
  });

  test('extracts a simple JSON object', () => {
    const text = '{"key": "value"}';
    expect(extractFirstJsonValueFromText(text)).toEqual({ key: 'value' });
  });

  test('extracts a simple JSON array', () => {
    const text = '["value1", "value2"]';
    expect(extractFirstJsonValueFromText(text)).toEqual(['value1', 'value2']);
  });

  test('extracts JSON surrounded by other text', () => {
    const text = 'Here is the data: {"name": "Alice", "age": 30}. Please use it.';
    expect(extractFirstJsonValueFromText(text)).toEqual({ name: 'Alice', age: 30 });
  });

  test('extracts JSON from markdown code blocks', () => {
    const text = `
Here is the JSON:
\`\`\`json
{
  "nested": {
    "array": [1, 2, 3]
  }
}
\`\`\`
End of message.
    `;
    expect(extractFirstJsonValueFromText(text)).toEqual({ nested: { array: [1, 2, 3] } });
  });

  test('handles string literals containing json brackets', () => {
    const text = '{"message": "string with { and } and [ and ]"}';
    expect(extractFirstJsonValueFromText(text)).toEqual({
      message: 'string with { and } and [ and ]',
    });
  });

  test('handles escaped quotes inside string literals', () => {
    // The inner string is "quotes \"inside\""
    const text = '{"text": "quotes \\"inside\\""}';
    expect(extractFirstJsonValueFromText(text)).toEqual({ text: 'quotes "inside"' });
  });

  test('handles complex escaping', () => {
    const text = '{"text": "escaping \\\\\\" inside"}';
    expect(extractFirstJsonValueFromText(text)).toEqual({ text: 'escaping \\" inside' });
  });

  test('returns null for invalid JSON with matching brackets', () => {
    const text = '{"unquotedKey": value}';
    expect(extractFirstJsonValueFromText(text)).toBeNull();
  });

  test('returns null for unclosed JSON', () => {
    const text = '{"key": "value"';
    expect(extractFirstJsonValueFromText(text)).toBeNull();
  });

  test('finds matching bracket correctly with multiple similar brackets', () => {
    const text = 'Some text {"a": 1} more text {"b": 2}';
    expect(extractFirstJsonValueFromText(text)).toEqual({ a: 1 });
  });
});

describe('extractFirstJsonValueFromText more edge cases', () => {
  test('handles string literals with escaped quotes and brackets', () => {
    const text = '{"text": "quotes \\"with {\\""}';
    expect(extractFirstJsonValueFromText(text)).toEqual({ text: 'quotes "with {"' });
  });
});
