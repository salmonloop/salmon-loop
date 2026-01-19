export interface Diagnostic {
  file: string;
  line?: number;
  column?: number;
  severity: 'error' | 'warning';
  message: string;
  source: string; // e.g., 'eslint', 'tsc', 'pytest'
  suggestion?: string;
}
