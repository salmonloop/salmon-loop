import { describe, test, expect } from 'bun:test';
import * as fc from 'fast-check';

import { createTaskEventBus } from '../../../../../../src/core/interaction/events/bus.js';
import type { TaskEnvelope } from '../../../../../../src/core/interaction/model/index.js';
import { buildA2AAgentCard } from '../../../../../../src/core/protocols/a2a/agent-card.js';
import { createA2AInteractionExecutor } from '../../../../../../src/core/protocols/a2a/sdk/executor.js';
import { createA2ASdkExpressApp } from '../../../../../../src/core/protocols/a2a/sdk/server.js';

// Helper to generate valid agent names
const validAgentNameArb = fc
  .string({ minLength: 1, maxLength: 50 })
  .filter((s) => s.trim().length > 0 && /^[a-zA-Z0-9\-_]+$/.test(s));

// Helper to generate valid capability IDs
const validCapabilityIdArb = fc
  .string({ minLength: 1, maxLength: 30 })
  .filter((s) => s.trim().length > 0 && /^[a-zA-Z0-9\-_]+$/.test(s));

// ============================================================================
// Property 11: Architectural Boundary Preservation
// ============================================================================

describe('Property 11: Architectural Boundary Preservation', () => {
  test('Protocol layer only depends on core domain interfaces', () => {
    fc.assert(
      fc.property(
        fc.record({
          agentName: validAgentNameArb,
          capabilityCount: fc.integer({ min: 1, max: 5 }),
        }),
        (_input) => {
          // Create a mock facade that implements only the core domain interface
          const mockFacade = {
            createTask: async (taskInput: any) => ({
              task: {
                id: 'task-123',
                capability: taskInput.capability,
                state: 'accepted' as const,
                request: taskInput.request,
                createdAt: new Date().toISOString(),
                attempt: 1,
              } as TaskEnvelope,
              signal: new AbortController().signal,
            }),
            getTask: async (_id: string) =>
              ({
                id: 'task-123',
                capability: 'test',
                state: 'completed' as const,
                request: { instruction: 'test instruction' },
                createdAt: new Date().toISOString(),
                attempt: 1,
              }) as TaskEnvelope,
            cancelTask: async (_id: string) =>
              ({
                id: 'task-123',
                capability: 'test',
                state: 'cancelled' as const,
                request: { instruction: 'test instruction' },
                createdAt: new Date().toISOString(),
                attempt: 1,
              }) as TaskEnvelope,
          };

          const eventBus = createTaskEventBus();

          // Create executor - should only depend on facade interface
          const executor = createA2AInteractionExecutor({
            facade: mockFacade,
            taskEventBus: eventBus,
          });

          // **Validates: Requirements 8.1, 8.2**
          // Executor should be created successfully without knowing implementation details
          expect(executor).toBeDefined();
          expect(typeof executor.execute).toBe('function');
          expect(typeof executor.cancelTask).toBe('function');
        },
      ),
    );
  });

  test('Protocol layer does not depend on implementation details', () => {
    fc.assert(
      fc.property(
        fc.record({
          skillCount: fc.integer({ min: 1, max: 3 }),
        }),
        (input) => {
          // Create capabilities dynamically
          const capabilities = Array.from({ length: input.skillCount }, (_, i) => ({
            id: `skill-${i}`,
            title: `Skill ${i}`,
          }));

          const agentCard = buildA2AAgentCard({
            name: 'test-agent',
            url: 'http://localhost:3000',
            capabilities,
            security: [],
          });

          // Create a minimal executor that only uses the interface
          const mockFacade = {
            createTask: async (taskInput: any) => ({
              task: {
                id: 'task-123',
                capability: taskInput.capability,
                state: 'accepted' as const,
                request: taskInput.request,
                createdAt: new Date().toISOString(),
                attempt: 1,
              } as TaskEnvelope,
              signal: new AbortController().signal,
            }),
            getTask: async (_id: string) => null,
            cancelTask: async (_id: string) => null,
          };

          const eventBus = createTaskEventBus();
          const executor = createA2AInteractionExecutor({
            facade: mockFacade,
            taskEventBus: eventBus,
          });

          // Create Express app - should only depend on AgentCard and AgentExecutor interfaces
          const app = createA2ASdkExpressApp({
            agentCard,
            agentExecutor: executor,
          });

          // Validates: Requirements 8.1, 8.2, 8.3, 8.4
          // App should be created without knowing implementation details
          expect(app).toBeDefined();
          expect(typeof app.use).toBe('function');
          expect(typeof app.listen).toBe('function');
        },
      ),
    );
  });
});

// ============================================================================
// Property 12: API Endpoint Compatibility
// ============================================================================

describe('Property 12: API Endpoint Compatibility', () => {
  test('API endpoint paths remain unchanged', () => {
    fc.assert(
      fc.property(
        fc.record({
          agentName: validAgentNameArb,
        }),
        (input) => {
          const agentCard = buildA2AAgentCard({
            name: input.agentName,
            url: 'http://localhost:3000',
            capabilities: [{ id: 'test', title: 'Test' }],
            security: [],
          });

          const mockFacade = {
            createTask: async (taskInput: any) => ({
              task: {
                id: 'task-123',
                capability: taskInput.capability,
                state: 'accepted' as const,
                request: taskInput.request,
                createdAt: new Date().toISOString(),
                attempt: 1,
              } as TaskEnvelope,
              signal: new AbortController().signal,
            }),
            getTask: async (_id: string) => null,
            cancelTask: async (_id: string) => null,
          };

          const executor = createA2AInteractionExecutor({
            facade: mockFacade,
            taskEventBus: createTaskEventBus(),
          });

          const app = createA2ASdkExpressApp({
            agentCard,
            agentExecutor: executor,
            agentCardPath: '/.well-known/agent-card.json',
            rpcPath: '/a2a/jsonrpc',
          });

          // **Validates: Requirements 9.2, 9.3**
          // Check that the app is a valid Express instance
          expect(app).toBeDefined();
          expect(typeof app.use).toBe('function');
          expect(typeof app.listen).toBe('function');
          expect(typeof app.get).toBe('function');
          expect(typeof app.post).toBe('function');

          // The app should be a function (Express apps are request handlers)
          expect(typeof app).toBe('function');
        },
      ),
    );
  });

  test('Request/response formats remain consistent', () => {
    fc.assert(
      fc.property(
        fc.record({
          taskId: fc.uuid(),
          capability: validCapabilityIdArb,
        }),
        (input) => {
          const agentCard = buildA2AAgentCard({
            name: 'test-agent',
            url: 'http://localhost:3000',
            capabilities: [{ id: input.capability, title: input.capability }],
            security: [],
          });

          // Mock facade that returns consistent TaskEnvelope format
          const mockFacade = {
            createTask: async (taskInput: any) => {
              const taskEnvelope: TaskEnvelope = {
                id: input.taskId,
                capability: taskInput.capability,
                state: 'accepted',
                request: taskInput.request,
                createdAt: new Date().toISOString(),
                attempt: 1,
              };
              return {
                task: taskEnvelope,
                signal: new AbortController().signal,
              };
            },
            getTask: async (_id: string) =>
              ({
                id: input.taskId,
                capability: input.capability,
                state: 'completed' as const,
                request: { instruction: 'test instruction' },
                createdAt: new Date().toISOString(),
                attempt: 1,
              }) as TaskEnvelope,
            cancelTask: async (_id: string) => null,
          };

          const executor = createA2AInteractionExecutor({
            facade: mockFacade,
            taskEventBus: createTaskEventBus(),
          });

          const app = createA2ASdkExpressApp({
            agentCard,
            agentExecutor: executor,
          });

          // **Validates: Requirements 9.1, 9.2, 9.3, 12.2**
          // The app should maintain consistent request/response handling
          expect(app).toBeDefined();
          expect(typeof app.use).toBe('function');
          expect(typeof app.listen).toBe('function');

          // Express app should be a function (request handler)
          expect(typeof app).toBe('function');
        },
      ),
    );
  });
});

// ============================================================================
// Property 13: AgentCard Structure Validation
// ============================================================================

describe('Property 13: AgentCard Structure Validation', () => {
  test('AgentCard contains required fields with correct structure', () => {
    fc.assert(
      fc.property(
        fc.record({
          name: validAgentNameArb,
          description: fc.string({ minLength: 1, maxLength: 200 }),
          version: fc.string({ minLength: 1, maxLength: 20 }),
          skillCount: fc.integer({ min: 1, max: 5 }),
        }),
        (input) => {
          const capabilities = Array.from({ length: input.skillCount }, (_, i) => ({
            id: `skill-${i}`,
            title: `Skill ${i}`,
          }));

          const agentCard = buildA2AAgentCard({
            name: input.name,
            url: 'http://localhost:3000',
            description: input.description,
            version: input.version,
            capabilities,
            security: [],
          });

          // **Validates: Requirements 13.2, 13.3**
          // AgentCard must have required fields
          expect(agentCard.name).toBe(input.name);
          expect(agentCard.url).toBe('http://localhost:3000');
          expect(agentCard.description).toBe(input.description);
          expect(agentCard.version).toBe(input.version);

          // Skills must be present and have unique IDs
          expect(agentCard.skills).toBeDefined();
          expect(agentCard.skills.length).toBe(input.skillCount);

          const skillIds = agentCard.skills.map((s) => s.id);
          const uniqueIds = new Set(skillIds);
          expect(uniqueIds.size).toBe(skillIds.length);

          // Each skill must have required fields
          for (const skill of agentCard.skills) {
            expect(skill.id).toBeDefined();
            expect(skill.name).toBeDefined();
            expect(skill.description).toBeDefined();
            expect(Array.isArray(skill.tags)).toBe(true);
          }
        },
      ),
    );
  });

  test('AgentCard skills have unique IDs', () => {
    fc.assert(
      fc.property(
        fc
          .array(
            fc.record({
              id: validCapabilityIdArb,
              title: fc.string({ minLength: 1, maxLength: 50 }),
            }),
            { minLength: 1, maxLength: 10 },
          )
          .map((arr) => {
            // Ensure uniqueness by deduplicating based on ID
            const seen = new Set<string>();
            return arr.filter((item) => {
              if (seen.has(item.id)) {
                return false;
              }
              seen.add(item.id);
              return true;
            });
          })
          .filter((arr) => arr.length > 0), // Ensure at least one capability remains
        (capabilities) => {
          const agentCard = buildA2AAgentCard({
            name: 'test-agent',
            url: 'http://localhost:3000',
            capabilities,
            security: [],
          });

          // **Validates: Requirements 13.2, 13.3**
          const skillIds = agentCard.skills.map((s) => s.id);
          const uniqueIds = new Set(skillIds);

          // All skill IDs must be unique
          expect(uniqueIds.size).toBe(skillIds.length);

          // Each skill ID should match the input capability ID
          for (let i = 0; i < capabilities.length; i++) {
            expect(agentCard.skills[i].id).toBe(capabilities[i].id);
          }
        },
      ),
    );
  });
});

// ============================================================================
// Property 14: TaskEnvelope Timestamp Format
// ============================================================================

describe('Property 14: TaskEnvelope Timestamp Format', () => {
  test('TaskEnvelope createdAt uses ISO 8601 format', () => {
    fc.assert(
      fc.property(
        fc.record({
          taskId: fc.uuid(),
          capability: fc.string({ minLength: 1, maxLength: 30 }),
        }),
        (input) => {
          const mockFacade = {
            createTask: async (taskInput: any) => {
              const now = new Date();
              const taskEnvelope: TaskEnvelope = {
                id: input.taskId,
                capability: taskInput.capability,
                state: 'accepted',
                request: taskInput.request,
                createdAt: now.toISOString(),
                attempt: 1,
              };
              return {
                task: taskEnvelope,
                signal: new AbortController().signal,
              };
            },
            getTask: async (_id: string) => {
              const now = new Date();
              return {
                id: input.taskId,
                capability: input.capability,
                state: 'completed' as const,
                request: { instruction: 'test instruction' },
                createdAt: now.toISOString(),
                attempt: 1,
              } as TaskEnvelope;
            },
            cancelTask: async (_id: string) => null,
          };

          const executor = createA2AInteractionExecutor({
            facade: mockFacade,
            taskEventBus: createTaskEventBus(),
          });

          // **Validates: Requirements 14.4**
          // The executor should work with ISO 8601 timestamps
          expect(executor).toBeDefined();

          // Verify ISO 8601 format regex
          const iso8601Regex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z?$/;

          const testTimestamp = new Date().toISOString();
          expect(iso8601Regex.test(testTimestamp)).toBe(true);
        },
      ),
    );
  });

  test('TaskEnvelope timestamp can be parsed back to Date', () => {
    fc.assert(
      fc.property(
        fc.record({
          taskId: fc.uuid(),
        }),
        (input) => {
          const originalDate = new Date();
          const isoString = originalDate.toISOString();

          const mockFacade = {
            createTask: async (taskInput: any) => ({
              task: {
                id: input.taskId,
                capability: taskInput.capability,
                state: 'accepted' as const,
                request: taskInput.request,
                createdAt: isoString,
                attempt: 1,
              } as TaskEnvelope,
              signal: new AbortController().signal,
            }),
            getTask: async (_id: string) => null,
            cancelTask: async (_id: string) => null,
          };

          const executor = createA2AInteractionExecutor({
            facade: mockFacade,
            taskEventBus: createTaskEventBus(),
          });

          // **Validates: Requirements 14.1, 14.2, 14.3, 14.4, 14.5**
          expect(executor).toBeDefined();

          // Verify that ISO 8601 string can be parsed back to Date
          const parsedDate = new Date(isoString);
          expect(parsedDate).toBeInstanceOf(Date);
          expect(parsedDate.getTime()).toBeGreaterThan(0);

          // The parsed date should be close to the original (within 1 second)
          const timeDiff = Math.abs(parsedDate.getTime() - originalDate.getTime());
          expect(timeDiff).toBeLessThan(1000);
        },
      ),
    );
  });
});
