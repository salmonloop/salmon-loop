export interface RollbackResult {
  ok: boolean;
  attempted: string[];
  exitCode: number | null;
  stdout: string;
  stderr: string;
}
