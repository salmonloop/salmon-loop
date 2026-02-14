import { Box, Text } from 'ink';
import React from 'react';

import type { MarkdownRenderMode, MarkdownTheme } from '../../core/config/types.js';
import { readPlan } from '../../core/plan/index.js';
import type { PlanReadResult } from '../../core/plan/types.js';
import type { LoopEvent } from '../../core/types/index.js';
import { text } from '../locales/index.js';

import { bindAuthorizationDispatch, resolveAuthorization } from './authorization/bus.js';
import { StretchingThinking } from './components/animations/StretchingThinking.js';
import { CommandInput } from './components/CommandInput.js';
import { MessageList } from './components/MessageList.js';
import { StatusBannerLine } from './components/StatusBannerLine.js';
import { TodoDrawer } from './components/TodoDrawer.js';
import type { TodoItem, TodoPriority, TodoStatus } from './components/TodoDrawer.js';
import { UI_CONFIG } from './config.js';
import { useCommandLifecycle } from './hooks/useCommandLifecycle.js';
import { useLoopEvents } from './hooks/useLoopEvents.js';
import { useTerminalDimensions } from './hooks/useTerminalDimensions.js';
import { bindSelectionDispatch } from './selection/bus.js';
import { UIStoreProvider, useUIStore } from './store/context.js';
import { COLORS } from './styles/theme.js';

const MemoMessageList = React.memo(MessageList);

function buildTodoSummaryCard(todos: TodoItem[]): string {
  const maxItems = 12;
  const preview = todos.slice(0, maxItems);

  const lines: string[] = [];
  for (const t of preview) {
    const checked = t.status === 'done';
    // Keep TODO cards as plain text to avoid markdown list bullets (e.g. "*") injected by terminal renderers.
    lines.push(`[${checked ? 'x' : ' '}] ${t.text}`);
  }

  if (todos.length > preview.length) {
    lines.push(`… and ${todos.length - preview.length} more`);
  }

  return lines.join('\n');
}

function parseTodoPriority(text: string): { priority?: TodoPriority; text: string } {
  const trimmed = text.trimStart();
  const first = trimmed[0];
  if (first === '!') return { priority: 'high', text: trimmed.slice(1).trimStart() };
  if (first === '·') return { priority: 'medium', text: trimmed.slice(1).trimStart() };
  if (first === '‐') return { priority: 'low', text: trimmed.slice(1).trimStart() };
  return { priority: undefined, text: text.trim() };
}

function toTodoStatus(step: { checkbox?: 'checked' | 'unchecked'; status?: string }): TodoStatus {
  if (step.checkbox === 'checked' || step.status === 'done') return 'done';
  if (step.status === 'active' || step.status === 'conflict') return 'in_progress';
  return 'pending';
}

function toTodoItems(read: Pick<PlanReadResult, 'active' | 'pending' | 'recentDone'>): TodoItem[] {
  const ordered = [...(read.active ?? []), ...(read.pending ?? []), ...(read.recentDone ?? [])];
  const seen = new Set<string>();
  const items: TodoItem[] = [];

  for (const step of ordered) {
    if (!step?.stepId || seen.has(step.stepId)) continue;
    seen.add(step.stepId);
    if (step.stepId === 'work_root') continue;

    const parsed = parseTodoPriority(step.text);
    items.push({
      id: step.stepId,
      status: toTodoStatus(step),
      text: parsed.text,
      priority: parsed.priority,
    });
  }

  return items;
}

export const AppCore: React.FC<{
  mode: 'run' | 'chat';
  onStart: any;
  onChatInput?: any;
  getSuggestions?: (
    input: string,
  ) => Promise<{ name: string; description: string; command?: any }[]>;
  findCommand?: (name: string) => any;
  onInit?: (
    emit: (event: LoopEvent) => void,
    options: { signal: AbortSignal },
    dispatch: any,
  ) => void | Promise<void>;
  sessionManager: any;
  markdownTheme?: MarkdownTheme;
  markdownRenderMode?: MarkdownRenderMode;
}> = ({
  mode,
  onStart,
  onChatInput,
  getSuggestions: getSuggestionsProp,
  findCommand,
  onInit,
  sessionManager,
  markdownTheme,
  markdownRenderMode,
}) => {
  const { state, dispatch } = useUIStore();

  const lifecycleStatus = state.isThinking ? 'running' : 'idle';
  const { signal } = useCommandLifecycle(lifecycleStatus, () => process.exit(0));

  // Use modular hooks for environment and loop events
  useTerminalDimensions();
  const [todoExpanded, setTodoExpanded] = React.useState(false);
  const [todoItems, setTodoItems] = React.useState<TodoItem[]>([]);
  const [taskRunning, setTaskRunning] = React.useState(false);
  const repoRootRef = React.useRef<string>(process.cwd());
  if (repoRootRef.current === process.cwd()) {
    try {
      repoRootRef.current = String(sessionManager.getCurrent().meta.repoPath ?? process.cwd());
    } catch {
      // ignore
    }
  }
  React.useEffect(() => {
    try {
      repoRootRef.current = String(sessionManager.getCurrent().meta.repoPath ?? process.cwd());
    } catch {
      repoRootRef.current = process.cwd();
    }
  }, [sessionManager]);

  const todoSessionRef = React.useRef<{ sessionId: string; planPathHint: string } | null>(null);
  const refreshTimerRef = React.useRef<NodeJS.Timeout | null>(null);

  const refreshTodos = React.useCallback(async (): Promise<TodoItem[]> => {
    const runtime = todoSessionRef.current;
    if (!runtime?.sessionId) return [];
    try {
      const res: PlanReadResult = await readPlan({
        persistenceRoot: repoRootRef.current,
        sessionId: runtime.sessionId,
      });
      const items = toTodoItems(res);
      setTodoItems(items);
      return items;
    } catch {
      // Best-effort; UI should never crash due to plan persistence issues.
      return [];
    }
  }, []);

  const scheduleRefreshTodos = React.useCallback(() => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = setTimeout(() => {
      refreshTodos().catch(() => {});
    }, 120);
  }, [refreshTodos]);

  React.useEffect(() => {
    return () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
  }, []);

  const interceptEvent = React.useCallback(
    (event: LoopEvent) => {
      if (event.type === 'plan.runtime.ready') {
        todoSessionRef.current = { sessionId: event.sessionId, planPathHint: event.planPathHint };
        scheduleRefreshTodos();
      } else if (event.type === 'plan.runtime.unavailable') {
        todoSessionRef.current = null;
        setTodoItems([]);
      } else if (event.type === 'run.start') {
        // Prevent stale TODOs from a previous interrupted run from re-hydrating
        // before the new runtime plan is initialized.
        todoSessionRef.current = null;
        setTodoItems([]);
        setTodoExpanded(true);
        setTaskRunning(true);
        scheduleRefreshTodos();
      } else if (event.type === 'run.end') {
        void (async () => {
          const items = await refreshTodos();
          if (items.length === 0) return;

          const normalized = event.success
            ? items.map((t) => ({ ...t, status: 'done' as const }))
            : items;
          const content = buildTodoSummaryCard(normalized);

          dispatch({
            type: 'ADD_MESSAGE',
            payload: {
              id: `todo-card-${Date.now()}`,
              type: 'todo_card',
              content,
              timestamp: new Date(),
            },
          });
        })();

        setTodoExpanded(false);
        setTaskRunning(false);
      } else if (event.type === 'phase.end') {
        if (event.phase === 'PLAN') {
          scheduleRefreshTodos();
        }
      } else if (event.type === 'tool.call.end') {
        if (typeof event.toolName === 'string' && event.toolName.startsWith('plan.')) {
          scheduleRefreshTodos();
        }
      }
    },
    [dispatch, refreshTodos, scheduleRefreshTodos],
  );

  const { sanitizeAndDispatch } = useLoopEvents(mode, onStart, signal, {
    interceptEvent,
  });

  const initCalledRef = React.useRef(false);
  React.useEffect(() => {
    if (mode !== 'chat') return;
    if (!onInit) return;
    if (initCalledRef.current) return;
    initCalledRef.current = true;
    onInit((event: LoopEvent) => sanitizeAndDispatch(event), { signal }, dispatch);
  }, [mode, onInit, signal, dispatch, sanitizeAndDispatch]);

  const pendingConfirmationRef = React.useRef(state.pendingConfirmation);
  React.useEffect(() => {
    pendingConfirmationRef.current = state.pendingConfirmation;
  }, [state.pendingConfirmation]);

  React.useEffect(() => {
    bindAuthorizationDispatch(dispatch);
  }, [dispatch]);

  React.useEffect(() => {
    bindSelectionDispatch(dispatch);
  }, [dispatch]);

  const handleChatInput = React.useCallback(
    async (value: string) => {
      if (!onChatInput) return;

      const result = await onChatInput(
        value,
        (ev: any) => sanitizeAndDispatch(ev),
        {
          signal,
        },
        dispatch,
      );

      if (result?.action === 'NEED_CONFIRMATION') {
        dispatch({ type: 'SET_CONFIRMATION', payload: result.data });
      } else {
        dispatch({ type: 'SET_INPUT', payload: '' });
        if (pendingConfirmationRef.current) {
          dispatch({ type: 'CLEAR_CONFIRMATION' });
        }
      }

      return result;
    },
    [dispatch, onChatInput, sanitizeAndDispatch, signal],
  );

  return (
    <Box flexDirection="column" height="100%">
      {/* Message Display Area */}
      <Box
        flexGrow={1}
        flexDirection="column"
        paddingX={UI_CONFIG.MESSAGE_AREA_PADDING_X}
        paddingBottom={UI_CONFIG.MESSAGE_AREA_PADDING_BOTTOM}
      >
        <MemoMessageList markdownTheme={markdownTheme} markdownRenderMode={markdownRenderMode} />
      </Box>

      {/* Thinking Status */}
      {(state.isThinking || state.statusBanner) && (
        <Box paddingX={UI_CONFIG.MESSAGE_AREA_PADDING_X} paddingY={0} flexShrink={0}>
          {state.statusBanner ? (
            <StatusBannerLine face={state.statusBanner.face} label={state.statusBanner.label} />
          ) : (
            <StretchingThinking />
          )}
        </Box>
      )}

      {taskRunning && todoItems.length > 0 && (
        <TodoDrawer
          todos={todoItems}
          isExpanded={todoExpanded}
          onToggle={() => setTodoExpanded((v) => !v)}
        />
      )}

      {/* Command Prompt */}
      <Box
        flexDirection="column"
        marginTop={0}
        flexShrink={0}
        borderStyle="single"
        borderTop
        borderBottom={false}
        borderLeft={false}
        borderRight={false}
        borderColor={COLORS.border.subtle}
      >
        <Box paddingY={1} flexDirection="row" paddingX={UI_CONFIG.INPUT_ROW_PADDING_X}>
          <Box marginRight={1}>
            <Text color={COLORS.semantic.salmon} bold>
              {' '}
              {'s8p>'}{' '}
            </Text>
          </Box>
          <CommandInput
            value={state.inputContent}
            onChange={(val) => dispatch({ type: 'SET_INPUT', payload: val })}
            getSuggestions={(input) =>
              getSuggestionsProp ? getSuggestionsProp(input) : Promise.resolve([])
            }
            findCommand={findCommand}
            onSubmit={async (val) => {
              if (state.pendingAuthorization) {
                const trimmed = val.trim();
                const [challenge, mode] = trimmed.split(/\s+/);
                if (challenge === state.pendingAuthorization.challenge) {
                  if (mode === 'save' || mode === 'repo') {
                    resolveAuthorization(state.pendingAuthorization.id, {
                      outcome: 'allow',
                      persist: 'repo',
                    });
                  } else if (mode === 'global' || mode === 'user') {
                    resolveAuthorization(state.pendingAuthorization.id, {
                      outcome: 'allow',
                      persist: 'user',
                    });
                  } else {
                    const allowSession = mode === 'all' || mode === 'session';
                    resolveAuthorization(state.pendingAuthorization.id, {
                      outcome: allowSession ? 'allow_session' : 'allow_once',
                    });
                  }
                }
                dispatch({ type: 'SET_INPUT', payload: '' });
                return;
              }

              if (onChatInput && val.trim()) {
                // Explicitly add user message to history for navigation
                dispatch({
                  type: 'ADD_MESSAGE',
                  payload: {
                    id: `user-${Date.now()}`,
                    type: 'user',
                    content: val,
                    timestamp: new Date(),
                  },
                });

                try {
                  await handleChatInput(val);
                } catch (_error) {
                  // Swallow to keep UI responsive.
                }
              }
            }}
            placeholder={text.cli.gui.inputPlaceholder}
          />
        </Box>
      </Box>
    </Box>
  );
};

export const App: React.FC<any> = (props) => (
  <UIStoreProvider>
    <AppCore {...props} />
  </UIStoreProvider>
);
