import { Box, Text, useInput } from 'ink';
import Spinner from 'ink-spinner';
import React, { useMemo } from 'react';

import { COLORS } from '../styles/theme.js';

export type TodoStatus = 'done' | 'in_progress' | 'pending';
export type TodoPriority = 'high' | 'medium' | 'low';

export interface TodoItem {
  id: string;
  status: TodoStatus;
  text: string;
  priority?: TodoPriority;
}

export interface TodoDrawerProps {
  todos: TodoItem[];
  isExpanded: boolean;
  onToggle: () => void;
  hint?: string;
  maxVisible?: number;
}

function StatusIcon({ status }: { status: TodoStatus }) {
  const color = statusColor(status);
  switch (status) {
    case 'done':
      return <Text color={color}>[x]</Text>;
    case 'in_progress':
      return (
        <Text color={color}>
          [<Spinner type="dots" />]
        </Text>
      );
    case 'pending':
      return <Text color={color}>[ ]</Text>;
  }
}

function statusColor(status: TodoStatus) {
  switch (status) {
    case 'done':
      return COLORS.semantic.cyan;
    case 'in_progress':
      return COLORS.semantic.yellow;
    case 'pending':
      return COLORS.text.muted;
  }
}

function priorityIcon(priority?: TodoPriority) {
  switch (priority) {
    case 'high':
      return '!';
    case 'medium':
      return '·';
    case 'low':
      return '‐';
    default:
      return ' ';
  }
}

function priorityColor(priority?: TodoPriority) {
  switch (priority) {
    case 'high':
      return COLORS.semantic.red;
    case 'medium':
      return COLORS.semantic.yellow;
    case 'low':
      return COLORS.text.muted;
    default:
      return COLORS.text.muted;
  }
}

export function TodoDrawer({
  todos,
  isExpanded,
  onToggle,
  hint = 'Ctrl+T',
  maxVisible = 8,
}: TodoDrawerProps) {
  useInput((input, key) => {
    if (
      key.ctrl &&
      (input === 't' || input === 'T' || input === '\u0014' || (key as any).name === 't')
    ) {
      onToggle();
    }
  });

  const visibleTodos = useMemo(() => todos.slice(0, Math.max(0, maxVisible)), [todos, maxVisible]);
  const toggleLabel = isExpanded ? '▲' : '▼';

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderTop
      borderBottom={false}
      borderLeft={false}
      borderRight={false}
      borderColor={COLORS.border.subtle}
    >
      <Box flexDirection="row" justifyContent="space-between" paddingX={2} paddingY={0}>
        <Box>
          <Text color={COLORS.semantic.blue} bold>
            TODO
          </Text>
        </Box>
        <Box>
          <Text color={COLORS.text.muted} dimColor>
            {toggleLabel} ({hint})
          </Text>
        </Box>
      </Box>

      {isExpanded && (
        <Box flexDirection="column" paddingX={2} paddingY={0}>
          {visibleTodos.length === 0 ? (
            <Text color={COLORS.text.muted} dimColor>
              No tasks yet.
            </Text>
          ) : (
            visibleTodos.map((t) => (
              <Box key={t.id} flexDirection="row">
                <Box width={4}>
                  <StatusIcon status={t.status} />
                </Box>
                <Box width={2}>
                  <Text color={priorityColor(t.priority)}>{priorityIcon(t.priority)}</Text>
                </Box>
                <Box flexGrow={1}>
                  <Text wrap="truncate" color={COLORS.text.primary}>
                    {t.text}
                  </Text>
                </Box>
              </Box>
            ))
          )}
        </Box>
      )}
    </Box>
  );
}
