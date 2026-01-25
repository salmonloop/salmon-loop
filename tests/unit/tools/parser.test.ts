import { ToolParser, ToolParseError } from '../../../src/core/tools/parser';

describe('ToolParser', () => {
  let parser: ToolParser;

  beforeEach(() => {
    parser = new ToolParser();
  });

  it('should parse a valid <sl_tool_call v="1"> correctly', () => {
    const text =
      'I will list the files. <sl_tool_call v="1">{"toolName": "ls", "args": {"path": "."}}</sl_tool_call>';
    const result = parser.parse(text);

    expect(result).toEqual({
      tool: 'ls',
      args: { path: '.' },
    });
  });

  it('should ignore legacy <tool_call> tags (Backward Compatibility: Do not execute)', () => {
    const text = 'Use old format: <tool_call>{"tool": "ls"}</tool_call>';
    const result = parser.parse(text);
    expect(result).toBeNull();
  });

  it('should THROW on <call:...> format (Protocol Violation)', () => {
    const text = 'Use Claude format: <call:ls>{"path": "."}</call:ls>';
    expect(() => parser.parse(text)).toThrow(ToolParseError);
    expect(() => parser.parse(text)).toThrow(/Protocol Violation/);
  });

  it('should ignore tool calls inside markdown code blocks (Anti-Confused Deputy)', () => {
    const text = `
Here is an example:
\`\`\`json
<sl_tool_call v="1">{"toolName": "rm_rf", "args": {"path": "/"}}</sl_tool_call>
\`\`\`
I will not execute the code in the block above.
    `;
    const result = parser.parse(text);
    expect(result).toBeNull();
  });

  it('should reject multiple tool calls to prevent ambiguity', () => {
    const text = `
    <sl_tool_call v="1">{"toolName": "ls", "args": {}}</sl_tool_call>
    <sl_tool_call v="1">{"toolName": "cat", "args": {"file": "secret.txt"}}</sl_tool_call>
    `;
    expect(() => parser.parse(text)).toThrow(ToolParseError);
    expect(() => parser.parse(text)).toThrow(/Ambiguous tool call/);
  });

  it('should throw on malformed JSON content', () => {
    const text = '<sl_tool_call v="1">{"toolName": "ls", "args": { invalid_json }}</sl_tool_call>';
    expect(() => parser.parse(text)).toThrow(ToolParseError);
    expect(() => parser.parse(text)).toThrow(/Failed to parse tool call JSON/);
  });

  it('should throw if "toolName" field is missing', () => {
    const text = '<sl_tool_call v="1">{"args": {}}</sl_tool_call>';
    expect(() => parser.parse(text)).toThrow(ToolParseError);
    expect(() => parser.parse(text)).toThrow(/toolName/);
  });

  it('should throw if "args" field is missing', () => {
    const text = '<sl_tool_call v="1">{"toolName": "ls"}</sl_tool_call>';
    expect(() => parser.parse(text)).toThrow(ToolParseError);
    expect(() => parser.parse(text)).toThrow(/args/);
  });
});
