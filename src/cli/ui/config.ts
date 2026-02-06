/**
 * Centralized UI configuration for the CLI.
 * Strictly follows AGENTS.md for English-only comments and standardized constants.
 */
export const UI_CONFIG = {
  /**
   * Character limit for system log messages in the UI.
   * Prevents TUI performance degradation from massive strings.
   */
  LOG_CHAR_LIMIT: 1000,

  /**
   * Character limit for structured content like code blocks.
   * Large enough to show significant diffs but capped for stability.
   */
  STRUCTURED_CONTENT_LIMIT: 10000,

  /**
   * Character limit for AI/user conversational content.
   * This avoids truncating normal model replies that are not markdown code blocks.
   */
  CONVERSATION_CONTENT_LIMIT: 10000,

  /**
   * Throttle delay (ms) for terminal resize events.
   * Reducing this value makes the UI more responsive to resizing,
   * while increasing it reduces rendering overhead.
   */
  RESIZE_THROTTLE_MS: 100,

  /**
   * Animation frame interval (ms) for ThinkingWave.
   */
  ANIMATION_INTERVAL_MS: 200,

  /**
   * Horizontal padding for the main message display area.
   */
  MESSAGE_AREA_PADDING_X: 4,

  /**
   * Vertical padding (specifically bottom) for the main message display area
   * to separate it from the thinking status.
   */
  MESSAGE_AREA_PADDING_BOTTOM: 1,

  /**
   * Horizontal padding for the input/active row.
   */
  INPUT_ROW_PADDING_X: 1,

  /**
   * Default terminal dimensions if detection fails.
   */
  DEFAULT_WIDTH: 80,
  DEFAULT_HEIGHT: 24,

  /**
   * Maximum number of autocomplete suggestions to display at once.
   * If exceeded, the list becomes scrollable.
   */
  MAX_SUGGESTIONS: 10,

  /**
   * Maximum characters for queue preview lines in the message area.
   */
  QUEUE_PREVIEW_MAX_CHARS: 80,
};
