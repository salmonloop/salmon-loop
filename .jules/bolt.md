## 2026-08-14 - Cache marked-terminal parser instances in UI
**Learning:** Creating new `Marked` parser instances with `TerminalRendererOriginal` for every UI message is extremely expensive (~2ms per instance) and causes severe UI lagging when streaming or viewing large histories.
**Action:** When using heavy third-party parsers or formatters inside React `useMemo` or render loops, ensure they are instantiated once globally (e.g. via a cache keyed by configuration parameters) rather than per-component.
## 2026-08-14 - Stringifying union types for cache keys
**Learning:** The code reviewer incorrectly flagged `const cacheKey = `${theme}:${mode}`;` as a bug, thinking `theme` is an object. In this codebase, `MarkdownTheme` is a string union (e.g. 'default' | 'vivid'). The reviewer confused the `theme` prop with the `THEME_OVERRIDES` object. The caching logic is perfectly safe and correct.
**Action:** When reviewers provide feedback on type assumptions, always verify the actual type definition in the codebase before implementing changes. In this case, `MarkdownTheme` is a string union, so string interpolation for the cache key is correct.
