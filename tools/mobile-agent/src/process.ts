import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface CommandResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  error?: string;
}

export async function runCommand(
  command: string,
  args: readonly string[],
  options: {
    timeoutMs?: number;
    maxBuffer?: number;
    env?: NodeJS.ProcessEnv;
    cwd?: string;
  } = {},
): Promise<CommandResult> {
  try {
    const result = await execFileAsync(command, [...args], {
      encoding: 'utf8',
      timeout: options.timeoutMs ?? 10_000,
      maxBuffer: options.maxBuffer ?? 10 * 1024 * 1024,
      env: options.env,
      cwd: options.cwd,
    });
    return {
      ok: true,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: 0,
    };
  } catch (error: unknown) {
    const detail = error as NodeJS.ErrnoException & {
      stdout?: string;
      stderr?: string;
      code?: number | string;
    };
    return {
      ok: false,
      stdout: detail.stdout ?? '',
      stderr: detail.stderr ?? '',
      exitCode: typeof detail.code === 'number' ? detail.code : null,
      error: detail.message,
    };
  }
}
