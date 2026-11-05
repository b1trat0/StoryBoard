import { spawn } from 'node:child_process';

/**
 * Process plumbing for the backup scripts.
 *
 * The only job here is running Docker with a real exit code and a captured stdout.
 * `exec` would be shorter but cannot pipe binary data in and out reliably, and a
 * pg_dump stream is binary.
 */

export interface ProcessResult {
  exitCode: number;
  stdout: Buffer;
  stderr: string;
}

/**
 * Runs a process to completion, capturing stdout as bytes.
 *
 * @param command - Executable name or path.
 * @param args - Arguments, passed without a shell so no quoting rules apply.
 * @param input - Optional bytes written to the process's stdin.
 * @returns Exit code, captured stdout and captured stderr.
 * @throws When the executable cannot be started at all (Docker not on PATH).
 */
export function runProcess(
  command: string,
  args: readonly string[],
  input?: Buffer,
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    const chunks: Buffer[] = [];
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({ exitCode: code ?? -1, stdout: Buffer.concat(chunks), stderr });
    });

    child.stdin.end(input);
  });
}

/**
 * Runs a command inside a container.
 *
 * `-i` is only added when bytes are supplied, because an interactive stdin on a
 * command that does not read it can hang under some Docker versions.
 *
 * @param container - Container name.
 * @param args - Command and arguments to run inside it.
 * @param input - Optional bytes for the container's stdin.
 * @returns The process result.
 */
export function runInContainer(
  container: string,
  args: readonly string[],
  input?: Buffer,
): Promise<ProcessResult> {
  const stdinFlag = input === undefined ? [] : ['-i'];
  return runProcess('docker', ['exec', ...stdinFlag, container, ...args], input);
}

/**
 * Trims a captured stderr stream down to something worth printing in an error.
 *
 * @param result - A failed process result.
 * @returns A single line naming the exit code and the last line of stderr.
 */
export function describeFailure(result: ProcessResult): string {
  const lastLine =
    result.stderr
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .pop() ?? 'no output';
  return `exit ${result.exitCode}: ${lastLine}`;
}
