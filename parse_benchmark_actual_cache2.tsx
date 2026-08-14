import { MarkdownTheme, MarkdownRenderMode } from './src/core/config/types/primitives.js';

const theme: MarkdownTheme = 'default';
const mode: MarkdownRenderMode = 'native';

const cacheKey = `${theme}:${mode}`;
console.log(cacheKey);
