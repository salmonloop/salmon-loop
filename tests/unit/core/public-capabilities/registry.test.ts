import { describe, expect, test } from 'bun:test';

import { FLOW_MODE_PUBLIC_METADATA } from '../../../../src/core/public-capabilities/flow-mode-metadata.ts';
import { buildPublicCapabilityRegistry } from '../../../../src/core/public-capabilities/registry.ts';

describe('public capability registry', () => {
  test('defines explicit kind, surfaces, and reachability for every entry', () => {
    const entries = buildPublicCapabilityRegistry();

    expect(entries.length).toBeGreaterThan(0);

    for (const entry of entries) {
      expect(entry).toEqual(
        expect.objectContaining({
          kind: expect.any(String),
          surfaces: expect.any(Object),
          reachability: expect.any(String),
        }),
      );
      expect(Object.keys(entry.surfaces).sort()).toEqual(['a2a', 'acp']);
    }
  });

  test('registers autopilot as a reachable flow mode on ACP and A2A', () => {
    const entry = buildPublicCapabilityRegistry().find((item) => item.id === 'autopilot');

    expect(entry).toMatchObject({
      id: 'autopilot',
      kind: 'flow_mode',
      target: 'autopilot',
      reachability: 'reachable',
      surfaces: {
        a2a: true,
        acp: true,
      },
    });
  });

  test('uses canonical flow mode metadata for public titles and descriptions', () => {
    const entry = buildPublicCapabilityRegistry().find((item) => item.id === 'autopilot');

    expect(entry).toMatchObject({
      title: FLOW_MODE_PUBLIC_METADATA.autopilot.publicTitle,
      description: FLOW_MODE_PUBLIC_METADATA.autopilot.description,
    });
  });

  test('allows ACP and A2A exposure to differ', () => {
    const entry = buildPublicCapabilityRegistry().find((item) => item.id === 'patch');

    expect(entry).toMatchObject({
      id: 'patch',
      surfaces: {
        a2a: false,
        acp: true,
      },
    });
  });

  test('does not include a sidecar surface in the model', () => {
    const entry = buildPublicCapabilityRegistry()[0];

    expect(Object.keys(entry.surfaces).sort()).toEqual(['a2a', 'acp']);
    expect('sidecar' in entry.surfaces).toBe(false);
  });
});
