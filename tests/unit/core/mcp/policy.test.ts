import { describe, expect, it } from 'bun:test';

import { buildMcpPolicyEvent } from '../../../../src/core/mcp/observability/events.js';
import { decideMcpApprovalPolicy } from '../../../../src/core/mcp/policy/approval-policy.js';
import { classifyMcpTool } from '../../../../src/core/mcp/policy/classifier.js';
import { McpPolicyEngine, type McpGrant } from '../../../../src/core/mcp/policy/grants.js';
import { evaluateMcpUriPolicy } from '../../../../src/core/mcp/policy/uri-policy.js';
import { Phase } from '../../../../src/core/types/runtime.js';

describe('McpPolicyEngine', () => {
  it('allows tools by matching server, action, target, and grant phase', () => {
    const grants: McpGrant[] = [
      {
        server: 'local',
        capability: 'tools',
        actions: ['call'],
        target: 'read_file',
        phase: Phase.CONTEXT,
        outcome: 'allow',
      },
    ];
    const engine = new McpPolicyEngine(grants);

    const decision = engine.decide({
      server: { name: 'local', transport: 'stdio', trust: 'local' },
      capability: 'tools',
      action: 'call',
      target: 'read_file',
      phase: Phase.CONTEXT,
      tool: { name: 'read_file', annotations: { readOnlyHint: true } },
    });

    expect(decision.allowed).toBe(true);
    expect(decision.outcome).toBe('allow');
    expect(decision.phase).toBe(Phase.CONTEXT);
  });

  it('does not hard-code MCP tools to VERIFY phase', () => {
    const engine = new McpPolicyEngine([
      {
        server: 'local',
        capability: 'tools',
        actions: ['call'],
        target: 'plan_lookup',
        phase: Phase.PLAN,
        outcome: 'allow',
      },
    ]);

    const planDecision = engine.decide({
      server: { name: 'local', transport: 'stdio', trust: 'local' },
      capability: 'tools',
      action: 'call',
      target: 'plan_lookup',
      phase: Phase.PLAN,
      tool: { name: 'plan_lookup', annotations: { readOnlyHint: true } },
    });
    const verifyDecision = engine.decide({
      server: { name: 'local', transport: 'stdio', trust: 'local' },
      capability: 'tools',
      action: 'call',
      target: 'plan_lookup',
      phase: Phase.VERIFY,
      tool: { name: 'plan_lookup', annotations: { readOnlyHint: true } },
    });

    expect(planDecision.allowed).toBe(true);
    expect(verifyDecision.allowed).toBe(false);
    expect(verifyDecision.denyReason).toBe('MCP_TOOL_NOT_GRANTED');
  });

  it('denies resource reads unless the URI matches exact, prefix, or glob-like rules', () => {
    const engine = new McpPolicyEngine([
      {
        server: 'data',
        capability: 'resources',
        actions: ['read'],
        target: [
          'file:///repo/README.md',
          { kind: 'prefix', pattern: 'file:///repo/docs/' },
          'db://public/*',
        ],
        outcome: 'allow',
      },
    ]);

    expect(
      engine.decide({
        server: { name: 'data', transport: 'stdio', trust: 'local' },
        capability: 'resources',
        action: 'read',
        target: 'file:///repo/README.md',
      }).allowed,
    ).toBe(true);
    expect(
      engine.decide({
        server: { name: 'data', transport: 'stdio', trust: 'local' },
        capability: 'resources',
        action: 'read',
        target: 'file:///repo/docs/guide.md',
      }).allowed,
    ).toBe(true);
    expect(
      engine.decide({
        server: { name: 'data', transport: 'stdio', trust: 'local' },
        capability: 'resources',
        action: 'read',
        target: 'db://public/users',
      }).allowed,
    ).toBe(true);
    expect(
      engine.decide({
        server: { name: 'data', transport: 'stdio', trust: 'local' },
        capability: 'resources',
        action: 'read',
        target: 'file:///repo/private.env',
      }).allowed,
    ).toBe(false);
  });

  it('keeps tools, resources, prompts, roots, sampling, and elicitation grants separate', () => {
    const engine = new McpPolicyEngine([
      {
        server: 'mixed',
        capability: 'prompts',
        actions: ['read'],
        target: 'review',
        outcome: 'allow',
      },
      {
        server: 'mixed',
        capability: 'roots',
        actions: ['read'],
        target: 'workspace',
        outcome: 'allow',
      },
      {
        server: 'mixed',
        capability: 'elicitation',
        actions: ['request'],
        target: 'confirm',
        outcome: 'ask',
      },
    ]);

    expect(
      engine.decide({
        server: { name: 'mixed', transport: 'stdio', trust: 'local' },
        capability: 'prompts',
        action: 'read',
        target: 'review',
      }).allowed,
    ).toBe(true);
    expect(
      engine.decide({
        server: { name: 'mixed', transport: 'stdio', trust: 'local' },
        capability: 'roots',
        action: 'read',
        target: 'workspace',
      }).allowed,
    ).toBe(true);
    expect(engine.decideElicitation('mixed').needsApproval).toBe(true);
    expect(
      engine.decide({
        server: { name: 'mixed', transport: 'stdio', trust: 'local' },
        capability: 'tools',
        action: 'call',
        target: 'review',
      }).allowed,
    ).toBe(false);
  });

  it('defaults sampling to deny and elicitation to ask without a grant', () => {
    const engine = new McpPolicyEngine();

    const sampling = engine.decideSampling('remote');
    const elicitation = engine.decideElicitation('remote');

    expect(sampling.outcome).toBe('deny');
    expect(sampling.allowed).toBe(false);
    expect(elicitation.outcome).toBe('ask');
    expect(elicitation.needsApproval).toBe(true);
  });

  it('allows sampling only when an explicit grant says so', () => {
    const engine = new McpPolicyEngine([
      {
        server: 'sampler',
        capability: 'sampling',
        actions: ['request'],
        target: 'completion',
        outcome: 'allow',
      },
    ]);

    const decision = engine.decide({
      server: { name: 'sampler', transport: 'stdio', trust: 'local' },
      capability: 'sampling',
      action: 'request',
      target: 'completion',
    });

    expect(decision.allowed).toBe(true);
    expect(decision.outcome).toBe('allow');
  });

  it('raises remote server risk above local server risk', () => {
    const grant: McpGrant = {
      server: '*',
      capability: 'tools',
      actions: ['call'],
      target: 'fetch_status',
      outcome: 'allow',
    };
    const engine = new McpPolicyEngine([grant]);

    const local = engine.decide({
      server: { name: 'local', transport: 'stdio', trust: 'local' },
      capability: 'tools',
      action: 'call',
      target: 'fetch_status',
      tool: { name: 'fetch_status', annotations: { readOnlyHint: true } },
      phase: Phase.CONTEXT,
    });
    const remote = engine.decide({
      server: { name: 'remote', transport: 'http', trust: 'remote' },
      capability: 'tools',
      action: 'call',
      target: 'fetch_status',
      tool: { name: 'fetch_status', annotations: { readOnlyHint: true } },
      phase: Phase.CONTEXT,
    });

    expect(local.risk).toBe('medium');
    expect(remote.risk).toBe('high');
  });
});

describe('MCP policy helpers', () => {
  it('classifies tools from annotations, name, and conservative config override', () => {
    const writeTool = classifyMcpTool({
      name: 'delete_remote_file',
      annotations: { openWorldHint: true },
    });
    const downgraded = classifyMcpTool(
      {
        name: 'delete_remote_file',
        annotations: { openWorldHint: true },
      },
      {
        override: {
          risk: 'low',
          facets: { write: false },
          reason: 'configured as read-only facade',
        },
      },
    );

    expect(writeTool.risk).toBe('high');
    expect(writeTool.facets.write).toBe(true);
    expect(writeTool.facets.network).toBe(true);
    expect(downgraded.risk).toBe('medium');
    expect(downgraded.facets.write).toBe(false);
  });

  it('evaluates exact, prefix, and glob-like URI policy rules', () => {
    expect(evaluateMcpUriPolicy('file:///repo/a.txt', ['file:///repo/a.txt']).allowed).toBe(true);
    expect(
      evaluateMcpUriPolicy('file:///repo/docs/a.txt', [
        { kind: 'prefix', pattern: 'file:///repo/docs/' },
      ]).allowed,
    ).toBe(true);
    expect(evaluateMcpUriPolicy('db://users/42', ['db://users/*']).allowed).toBe(true);
    expect(evaluateMcpUriPolicy('db://admin/42', ['db://users/*']).allowed).toBe(false);
  });

  it('approval policy defaults high risk to approval and low risk to allow', () => {
    expect(
      decideMcpApprovalPolicy({ capability: 'tools', action: 'call', risk: 'low' }).outcome,
    ).toBe('allow');
    expect(
      decideMcpApprovalPolicy({ capability: 'tools', action: 'call', risk: 'high' }).outcome,
    ).toBe('ask');
  });

  it('builds unified observability events with policy fields', () => {
    const event = buildMcpPolicyEvent({
      server: 'local',
      capability: 'tools',
      action: 'call',
      outcome: 'allow',
      reason: 'matched grant',
      phase: Phase.CONTEXT,
      risk: 'low',
      target: 'read_file',
    });

    expect(event).toMatchObject({
      type: 'mcp.policy.decision',
      server: 'local',
      capability: 'tools',
      action: 'call',
      outcome: 'allow',
      reason: 'matched grant',
      phase: Phase.CONTEXT,
      risk: 'low',
      riskLevel: 'low',
      target: 'read_file',
    });
    expect(typeof event.timestamp).toBe('string');
  });
});
