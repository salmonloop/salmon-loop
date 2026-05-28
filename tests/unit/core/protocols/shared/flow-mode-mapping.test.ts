import { describe, expect, test } from 'bun:test';

import {
  SUPPORTED_PROTOCOL_FLOW_MODES,
  parseA2ASkillFlowMode,
  parseAcpFlowMode,
} from '../../../../../src/core/protocols/shared/flow-mode-mapping.ts';

describe('protocol flow mode mapping', () => {
  test('parses ACP mode ids that match supported flow modes', () => {
    for (const mode of SUPPORTED_PROTOCOL_FLOW_MODES) {
      expect(parseAcpFlowMode(mode)).toBe(mode);
    }
  });

  test('degrades legacy ACP interactive and yolo values to autopilot', () => {
    expect(parseAcpFlowMode('interactive')).toBe('autopilot');
    expect(parseAcpFlowMode('yolo')).toBe('autopilot');
  });

  test('returns undefined for unknown ACP mode ids', () => {
    expect(parseAcpFlowMode('unknown')).toBeUndefined();
    expect(parseAcpFlowMode('')).toBeUndefined();
    expect(parseAcpFlowMode(null)).toBeUndefined();
  });

  test('maps A2A skill ids to supported flow modes', () => {
    for (const mode of SUPPORTED_PROTOCOL_FLOW_MODES) {
      expect(parseA2ASkillFlowMode(mode)).toBe(mode);
    }

    expect(parseA2ASkillFlowMode('review')).toBe('review');
    expect(parseA2ASkillFlowMode('unknown')).toBeUndefined();
  });
});
