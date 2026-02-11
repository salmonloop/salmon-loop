import { Box, Text, useInput } from 'ink';
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

function statusIcon(status: TodoStatus) {
  switch (status) {
    case 'done':
      return '[x]';
    case 'in_progress':
      return '[/]';
    case 'pending':
      return '[ ]';
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

function renderProgressBar(percent: number, width: number) {
  const clamped = Math.max(0, Math.min(100, percent));
  const filled = Math.round((clamped / 100) * width);
  return '█'.repeat(filled) + '░'.repeat(Math.max(0, width - filled));
}

export function TodoDrawer({
  todos,
  isExpanded,
  onToggle,
  hint = 'Ctrl+T',
  maxVisible = 8,
}: TodoDrawerProps) {
  useInput((input, key) => {
    if (key.ctrl && input === 't') {
      onToggle();
    }
  });

  const total = todos.length;
  const done = todos.filter((t) => t.status === 'done').length;
  const percent = total === 0 ? 0 : Math.round((done / total) * 100);

  const visibleTodos = useMemo(() => todos.slice(0, Math.max(0, maxVisible)), [todos, maxVisible]);
  const toggleLabel = isExpanded ? '[collapse ▲]' : '[expand ▼]';

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
          <Text color={COLORS.text.muted} dimColor>
            {' '}
            │{' '}
          </Text>
          <Text color={COLORS.text.muted} dimColor>
            {done}/{total} completed
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
          <Box
            flexDirection="column"
            borderStyle="double"
            borderColor={COLORS.border.subtle}
            paddingX={1}
            paddingY={0}
          >
            {visibleTodos.length === 0 ? (
              <Text color={COLORS.text.muted} dimColor>
                No tasks yet. Tasks are auto-tracked from SALMON's planning phase.
              </Text>
            ) : (
              visibleTodos.map((t, i) => (
                <Box key={t.id} flexDirection="row">
                  <Box width={4}>
                    <Text color={statusColor(t.status)}>{statusIcon(t.status)}</Text>
                  </Box>
                  <Box width={2}>
                    <Text color={priorityColor(t.priority)}>{priorityIcon(t.priority)}</Text>
                  </Box>
                  <Box width={4}>
                    <Text color={COLORS.text.muted} dimColor>
                      {String(i + 1).padStart(2, '0')}
                    </Text>
                    <Text color={COLORS.text.muted} dimColor>
                      {' '}
                      │
                    </Text>
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

          <Box flexDirection="row" marginTop={0}>
            <Text color={COLORS.semantic.salmon}>{renderProgressBar(percent, 44)}</Text>
            <Text color={COLORS.text.muted} dimColor>
              {' '}
              {percent}%
            </Text>
          </Box>
          <Text color={COLORS.text.muted} dimColor>
            Tasks are auto-tracked from SALMON's planning phase.
          </Text>
        </Box>
      )}
    </Box>
  );
}
