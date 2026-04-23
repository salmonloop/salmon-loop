import { describe, expect, test } from 'bun:test';

import { FLOW_MODE_PUBLIC_METADATA } from '../../../../src/core/public-capabilities/flow-mode-metadata.ts';
import {
  selectPublicCapabilitiesForSurface,
  toA2APublicSkills,
  toAcpPublicModes,
} from '../../../../src/core/public-capabilities/projections.ts';
import { buildPublicCapabilityRegistry } from '../../../../src/core/public-capabilities/registry.ts';
import type { PublicCapability } from '../../../../src/core/public-capabilities/types.ts';

const SAMPLE_ENTRIES: PublicCapability[] = [
  {
    id: 'autopilot',
    kind: 'flow_mode',
    target: 'autopilot',
    title: 'Autopilot',
    description: 'Let the agent decide which actions and tools to use.',
    surfaces: { a2a: true, acp: true },
    reachability: 'reachable',
    tags: ['default'],
    examples: ['Fix the failing test suite'],
  },
  {
    id: 'patch',
    kind: 'flow_mode',
    target: 'patch',
    title: 'Patch code',
    description: 'Apply code changes with verification.',
    surfaces: { a2a: false, acp: true },
    reachability: 'reachable',
  },
  {
    id: 'repo-summary',
    kind: 'workflow',
    target: 'repo-summary',
    title: 'Repository summary',
    description: 'Summarize repository state for handoff.',
    surfaces: { a2a: true, acp: false },
    reachability: 'reachable',
    tags: ['handoff', 'summary'],
    examples: ['Summarize the current branch status'],
  },
  {
    id: 'latent-skill',
    kind: 'local_skill',
    target: 'latent-skill',
    title: 'Latent skill',
    description: 'Not reachable yet.',
    surfaces: { a2a: true, acp: false },
    reachability: 'latent',
  },
  {
    id: 'disabled-skill',
    kind: 'local_skill',
    target: 'disabled-skill',
    title: 'Disabled skill',
    description: 'Disabled for production.',
    surfaces: { a2a: true, acp: false },
    reachability: 'disabled',
  },
];

function isReachableAcpFlowCapability(
  entry: PublicCapability,
): entry is Extract<PublicCapability, { kind: 'flow_mode' }> {
  return entry.kind === 'flow_mode' && entry.reachability === 'reachable' && entry.surfaces.acp;
}

describe('public capability projections', () => {
  test('selects only reachable capabilities for the requested surface', () => {
    expect(
      selectPublicCapabilitiesForSurface('a2a', SAMPLE_ENTRIES).map((entry) => entry.id),
    ).toEqual(['autopilot', 'repo-summary']);

    expect(
      selectPublicCapabilitiesForSurface('acp', SAMPLE_ENTRIES).map((entry) => entry.id),
    ).toEqual(['autopilot', 'patch']);
  });

  test('projects ACP modes from reachable flow modes only', () => {
    const modes = toAcpPublicModes(SAMPLE_ENTRIES);

    expect(modes).toEqual([
      {
        id: 'autopilot',
        name: FLOW_MODE_PUBLIC_METADATA.autopilot.acpName,
        description: FLOW_MODE_PUBLIC_METADATA.autopilot.description,
      },
      {
        id: 'patch',
        name: FLOW_MODE_PUBLIC_METADATA.patch.acpName,
        description: FLOW_MODE_PUBLIC_METADATA.patch.description,
      },
    ]);
  });

  test('projects A2A skills from reachable A2A capabilities and preserves metadata', () => {
    const skills = toA2APublicSkills(SAMPLE_ENTRIES);

    expect(skills).toEqual([
      {
        id: 'autopilot',
        title: 'Autopilot',
        description: FLOW_MODE_PUBLIC_METADATA.autopilot.description,
        tags: ['default'],
        examples: ['Fix the failing test suite'],
      },
      {
        id: 'repo-summary',
        title: 'Repository summary',
        description: 'Summarize repository state for handoff.',
        tags: ['handoff', 'summary'],
        examples: ['Summarize the current branch status'],
      },
    ]);
  });

  test('defaults to the static registry when entries are omitted', () => {
    const registry = buildPublicCapabilityRegistry();
    const reachableAcpFlowModes = registry
      .filter(isReachableAcpFlowCapability)
      .map((entry) => entry.target);
    const reachableA2AEntries = registry
      .filter((entry) => entry.reachability === 'reachable' && entry.surfaces.a2a)
      .map((entry) => entry.id);

    expect(selectPublicCapabilitiesForSurface('a2a')).toEqual(
      registry.filter((entry) => entry.reachability === 'reachable' && entry.surfaces.a2a),
    );
    expect(toAcpPublicModes().map((mode) => mode.id)).toEqual(reachableAcpFlowModes);
    expect(toA2APublicSkills().map((skill) => skill.id)).toEqual(reachableA2AEntries);
  });
});
