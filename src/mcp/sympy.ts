import path from 'node:path';
import { spawn } from 'node:child_process';
import { MCPError } from '@/lib/errors';

export interface SympyEquivalenceResult {
  equivalent: boolean;
  canonicalA?: string;
  canonicalB?: string;
  note?: string;
}

interface SympySuccessResponse<T> {
  ok: true;
  result: T;
}

interface SympyFailureResponse {
  ok: false;
  error: string;
}

type SympyResponse<T> = SympySuccessResponse<T> | SympyFailureResponse;

const RUNNER_PATH = path.resolve(process.cwd(), 'scripts', 'sympy_runner.py');
const TIMEOUT_MS = Number(process.env.SYMPY_TIMEOUT_MS ?? '10000');

function getPythonCandidates(): Array<{ command: string; args: string[] }> {
  const configured = process.env.SYMPY_PYTHON_BIN ?? process.env.PYTHON_BIN;
  if (configured) {
    return [{ command: configured, args: [] }];
  }

  if (process.platform === 'win32') {
    return [
      { command: 'python', args: [] },
      { command: 'py', args: ['-3'] },
    ];
  }

  return [
    { command: 'python3', args: [] },
    { command: 'python', args: [] },
  ];
}

function isSuccessResponse<T>(value: SympyResponse<T>): value is SympySuccessResponse<T> {
  return value.ok;
}

async function runPython(
  command: string,
  args: string[],
  payload: string,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(command, [...args, RUNNER_PATH], {
      stdio: 'pipe',
      shell: false,
      windowsHide: true,
      env: {
        ...process.env,
        PYTHONIOENCODING: 'utf-8',
      },
    });

    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, TIMEOUT_MS);

    const finish = (handler: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      handler();
    };

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      finish(() => reject(error));
    });
    child.on('close', (code) => {
      finish(() => {
        if (timedOut) {
          reject(new Error(`timed out after ${TIMEOUT_MS}ms`));
          return;
        }

        if (code !== 0) {
          reject(new Error(stderr.trim() || stdout.trim() || `exit ${code}`));
          return;
        }

        resolve(stdout);
      });
    });

    child.stdin.on('error', () => {
      // ignore broken pipe; close/error will surface the real failure.
    });
    child.stdin.end(payload);
  });
}

async function invokeSympy<T>(request: Record<string, unknown>): Promise<T> {
  const payload = `${JSON.stringify(request)}\n`;
  const errors: string[] = [];

  for (const candidate of getPythonCandidates()) {
    try {
      const stdout = await runPython(candidate.command, candidate.args, payload);
      const line = stdout
        .split(/\r?\n/)
        .map((item) => item.trim())
        .filter(Boolean)
        .at(-1);

      if (!line) {
        throw new Error('empty response');
      }

      const parsed = JSON.parse(line) as SympyResponse<T>;
      if (!isSuccessResponse(parsed)) {
        throw new Error(parsed.error);
      }

      return parsed.result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${candidate.command} ${candidate.args.join(' ')}: ${message}`.trim());
    }
  }

  throw new MCPError('sympy', errors.join(' | '));
}

export async function solve(equation: string): Promise<string[]> {
  return invokeSympy<string[]>({ op: 'solve', equation });
}

export async function equivalent(a: string, b: string): Promise<SympyEquivalenceResult> {
  return invokeSympy<SympyEquivalenceResult>({ op: 'equivalent', a, b });
}

export async function simplify(expr: string): Promise<string> {
  return invokeSympy<string>({ op: 'simplify', expr });
}
