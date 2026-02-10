/**
 * Salmon Loop CLI Theme
 * Based on Figma design system from CLI-AI-Assistant-Design
 * Color palette extracted from /home/shangxin/Projects/Cliaiassistantdesign
 */

import chalk from 'chalk';

import type { MessageType } from '../store/types.js';

/**
 * Core color palette (hex values from Figma design)
 */
export const COLORS = {
  // Background layers
  bg: {
    outer: '#0e1117', // Outer background (matched to terminal)
    terminal: '#0e1117', // Terminal main background
    highlight: '#171b22', // Hover/highlight areas
    errorBg: '#1a0f0f', // Error background
    warningBg: '#1a1a0f', // Warning background
  },

  // Text hierarchy
  text: {
    primary: '#c7d1db', // Primary text
    muted: '#6e7681', // Secondary/gray text
  },

  // Borders
  border: {
    main: '#1f2933', // Main borders (thick)
    subtle: '#21262d', // Subtle borders
  },

  // Semantic colors (key brand colors)
  semantic: {
    salmon: '#d95030', // Brand color - AI assistant messages
    cyan: '#30d9b9', // User messages, success states
    blue: '#3095d9', // PLAN type, checkpoint
    orange: '#ff9e64', // TOOL type
    red: '#ff6b6b', // Danger/error
    yellow: '#ffd93d', // Warning
  },
} as const;

/**
 * Ink-compatible color names
 * Maps Figma hex colors to Ink's supported color names
 */
export const INK_COLORS = {
  salmon: 'red' as const, // Closest to #d95030
  cyan: 'cyan' as const, // Matches #30d9b9
  blue: 'blue' as const, // Matches #3095d9
  orange: 'yellow' as const, // Closest to #ff9e64
  red: 'red' as const, // Matches #ff6b6b
  yellow: 'yellow' as const, // Matches #ffd93d
  gray: 'gray' as const,
  green: 'green' as const,
} as const;

/**
 * Message style configuration based on Figma design
 * Includes color, label, border, and spacing for each message type
 */
export const MESSAGE_STYLES: Record<
  MessageType,
  {
    inkColor: string;
    label: string | null;
    hasBorder: boolean;
    marginBottom: number;
  }
> = {
  // Level 1 - Emphasis (with border)
  assistant: {
    inkColor: COLORS.semantic.salmon,
    label: '<>< SALMON',
    hasBorder: true,
    marginBottom: 1,
  },
  assistant_stream: {
    inkColor: COLORS.semantic.salmon,
    label: '<>< SALMON',
    hasBorder: true,
    marginBottom: 1,
  },
  error: {
    inkColor: COLORS.semantic.red,
    label: 'ERROR',
    hasBorder: true,
    marginBottom: 1,
  },
  warning: {
    inkColor: COLORS.semantic.yellow,
    label: 'WARNING',
    hasBorder: true,
    marginBottom: 1,
  },

  // Level 2 - Standard
  user: {
    inkColor: COLORS.semantic.cyan,
    label: 'USER',
    hasBorder: false,
    marginBottom: 1,
  },
  tool_result: {
    inkColor: COLORS.semantic.orange,
    label: 'TOOL',
    hasBorder: false,
    marginBottom: 1,
  },
  checkpoint: {
    inkColor: COLORS.semantic.blue,
    label: 'CHKPT',
    hasBorder: false,
    marginBottom: 1,
  },
  interrupt: {
    inkColor: COLORS.semantic.red,
    label: 'INTR',
    hasBorder: false,
    marginBottom: 1,
  },

  // Level 3 - Lightweight (no label, compact)
  system: {
    inkColor: COLORS.text.muted,
    label: null,
    hasBorder: false,
    marginBottom: 0,
  },
  queue: {
    inkColor: COLORS.text.muted,
    label: null,
    hasBorder: false,
    marginBottom: 0,
  },
  thinking: {
    inkColor: COLORS.text.muted,
    label: 'THNK',
    hasBorder: false,
    marginBottom: 1,
  },
  explore_step: {
    inkColor: COLORS.semantic.blue,
    label: 'EXPL',
    hasBorder: false,
    marginBottom: 1,
  },
  plan_step: {
    inkColor: COLORS.semantic.blue,
    label: 'PLAN',
    hasBorder: false,
    marginBottom: 1,
  },
  patch_step: {
    inkColor: COLORS.semantic.blue,
    label: 'PATCH',
    hasBorder: false,
    marginBottom: 1,
  },
  apply_step: {
    inkColor: COLORS.semantic.blue,
    label: 'APPLY',
    hasBorder: false,
    marginBottom: 1,
  },
  validate_step: {
    inkColor: COLORS.semantic.blue,
    label: 'VLD',
    hasBorder: false,
    marginBottom: 1,
  },
  verify_step: {
    inkColor: COLORS.semantic.blue,
    label: 'VRF',
    hasBorder: false,
    marginBottom: 1,
  },
  preflight_step: {
    inkColor: COLORS.semantic.blue,
    label: 'PRE',
    hasBorder: false,
    marginBottom: 1,
  },
  context_step: {
    inkColor: COLORS.semantic.blue,
    label: 'CTX',
    hasBorder: false,
    marginBottom: 1,
  },
  ast_validate_step: {
    inkColor: COLORS.semantic.blue,
    label: 'AST',
    hasBorder: false,
    marginBottom: 1,
  },
  rollback_step: {
    inkColor: COLORS.semantic.blue,
    label: 'RLBK',
    hasBorder: false,
    marginBottom: 1,
  },
  shrink_step: {
    inkColor: COLORS.semantic.blue,
    label: 'SHRK',
    hasBorder: false,
    marginBottom: 1,
  },
  review_step: {
    inkColor: COLORS.semantic.blue,
    label: 'REVW',
    hasBorder: false,
    marginBottom: 1,
  },
  report_step: {
    inkColor: COLORS.semantic.blue,
    label: 'REPORT',
    hasBorder: false,
    marginBottom: 1,
  },
  analyze_issues_step: {
    inkColor: COLORS.semantic.blue,
    label: 'ANLZ',
    hasBorder: false,
    marginBottom: 1,
  },
  tool_call: {
    inkColor: COLORS.text.muted,
    label: null,
    hasBorder: false,
    marginBottom: 0,
  },
  welcome: {
    inkColor: COLORS.text.muted,
    label: null,
    hasBorder: false,
    marginBottom: 1,
  },
};

/**
 * Chalk-based theme for terminal output
 * Uses chalk.hex() for precise color matching
 */
export const SALMON_THEME = {
  // Message type colors (based on Figma LogStream component)
  messageType: {
    user: chalk.hex(COLORS.semantic.cyan), // Cyan - USER messages
    assistant: chalk.hex(COLORS.semantic.salmon), // Salmon - AI messages
    system: chalk.hex(COLORS.text.muted), // Gray - SYSTEM messages
    tool: chalk.hex(COLORS.semantic.orange), // Orange - TOOL calls
    plan: chalk.hex(COLORS.semantic.blue), // Blue - PLAN/analysis
    error: chalk.hex(COLORS.semantic.red), // Red - errors
    warning: chalk.hex(COLORS.semantic.yellow), // Yellow - warnings
  },

  // Text hierarchy
  text: {
    primary: chalk.hex(COLORS.text.primary),
    muted: chalk.hex(COLORS.text.muted),
    bold: chalk.hex(COLORS.text.primary).bold,
  },

  // Semantic colors for status/feedback
  semantic: {
    success: chalk.hex(COLORS.semantic.cyan),
    warning: chalk.hex(COLORS.semantic.yellow),
    error: chalk.hex(COLORS.semantic.red),
    info: chalk.hex(COLORS.semantic.blue),
  },

  // Brand elements
  brand: {
    salmon: chalk.hex(COLORS.semantic.salmon).bold,
    prompt: chalk.hex(COLORS.semantic.salmon).bold, // For s8p> prompt
    logo: chalk.hex(COLORS.semantic.salmon).bold, // For <><< ASCII salmon
  },

  // Border colors (Ink limitations - using closest named colors)
  border: {
    main: 'gray', // Approximates #1f2933
    subtle: 'gray', // Approximates #21262d
  },
} as const;

/**
 * Check if separator should be shown between messages
 * Based on Figma design's smart separator logic
 */
export function shouldShowSeparator(
  currentType: MessageType,
  nextType: MessageType | undefined,
): boolean {
  if (!nextType) return false;

  // Always separate user/assistant messages
  const emphasisTypes: MessageType[] = ['user', 'assistant', 'assistant_stream'];
  if (emphasisTypes.includes(currentType) || emphasisTypes.includes(nextType)) {
    return true;
  }

  // Get styles for level comparison
  const currentStyle = MESSAGE_STYLES[currentType];
  const nextStyle = MESSAGE_STYLES[nextType];

  if (!currentStyle || !nextStyle) {
    return true; // Default to showing separator if style is missing
  }

  // Keep lightweight messages compact (no separator between them)
  if (!currentStyle.label && !nextStyle.label) {
    return false;
  }

  // Separate on type change
  return currentType !== nextType;
}
