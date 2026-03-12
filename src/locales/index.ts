/**
 * User-facing messages for internationalization.
 *
 * IMPORTANT:
 * - This is for user-facing messages ONLY.
 * - DO NOT use this for debug logs.
 * - DO NOT use this for internal error messages that are not meant for the user.
 */
import { en } from './en.js';

export const text = en as typeof en;
export type LocaleText = typeof en;
