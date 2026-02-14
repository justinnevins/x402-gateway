import { Sandbox } from '@e2b/code-interpreter';

interface ExecuteRequest {
  language: 'python' | 'javascript';
  code: string;
  timeout?: number;
}

interface ExecuteResponse {
  stdout: string;
  stderr: string;
  exitCode: number;
  executionTime: number;
}

export async function executeCode(req: ExecuteRequest): Promise<ExecuteResponse> {
  const { language, code, timeout = 10 } = req;

  if (!language || !code) {
    throw new Error('language and code are required');
  }

  if (!['python', 'javascript'].includes(language)) {
    throw new Error('language must be "python" or "javascript"');
  }

  if (timeout > 30) {
    throw new Error('timeout must be 30 seconds or less');
  }

  const start = Date.now();
  let sandbox: Sandbox | null = null;

  try {
    sandbox = await Sandbox.create({
      timeoutMs: timeout * 1000 + 5000, // extra buffer for sandbox startup
    });

    const execution = await sandbox.runCode(code, {
      language: language === 'javascript' ? 'js' : 'python',
      timeoutMs: timeout * 1000,
    });

    const elapsed = (Date.now() - start) / 1000;

    // Collect stdout and stderr from results
    const stdout = execution.logs.stdout.join('');
    const stderr = execution.logs.stderr.join('');

    // Truncate output to 1MB
    const maxOutput = 1024 * 1024;

    return {
      stdout: stdout.length > maxOutput ? stdout.substring(0, maxOutput) + '\n[truncated]' : stdout,
      stderr: stderr.length > maxOutput ? stderr.substring(0, maxOutput) + '\n[truncated]' : stderr,
      exitCode: execution.error ? 1 : 0,
      executionTime: Math.round(elapsed * 100) / 100,
    };
  } finally {
    if (sandbox) {
      await sandbox.kill().catch(() => {});
    }
  }
}
