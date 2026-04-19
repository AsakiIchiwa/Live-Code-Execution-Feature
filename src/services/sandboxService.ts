import { spawn } from 'child_process';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { config } from '../config';
import { sanitizeOutput } from '../utils/helpers';

export interface SandboxResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  executionTimeMs: number;
  memoryUsedKb: number;
  timedOut: boolean;
}

interface LanguageConfig {
  name: string;
  version: string;
  fileExtension: string;
  maxTimeoutMs: number;
  maxMemoryKb: number;
}

/**
 * SandboxService executes user code in an isolated process.
 *
 * PRODUCTION NOTE: In a real deployment, this would use Docker containers
 * with nsjail/gVisor for full isolation. This implementation uses process-level
 * isolation with resource limits as a working demonstration.
 *
 * Security layers applied:
 * 1. Temporary directory per execution (cleaned up after)
 * 2. Hard timeout with SIGKILL (not SIGTERM — user cannot trap it)
 * 3. Output size truncation (prevents memory exhaustion on worker)
 * 4. No network access in production (Docker --network=none)
 */
export class SandboxService {
  private readonly workDir = join(tmpdir(), 'sandbox');

  constructor() {
    if (!existsSync(this.workDir)) {
      mkdirSync(this.workDir, { recursive: true });
    }
  }

  /**
   * Execute code in sandbox. Returns stdout, stderr, timing, and memory usage.
   */
  async execute(sourceCode: string, language: LanguageConfig): Promise<SandboxResult> {
    const executionId = randomUUID();
    const execDir = join(this.workDir, executionId);
    mkdirSync(execDir, { recursive: true });

    // For Java, filename must match public class name
    let fileName: string;
    if (language.name === 'java') {
      const classMatch = sourceCode.match(/public\s+class\s+(\w+)/);
      const className = classMatch ? classMatch[1] : 'Main';
      fileName = `${className}.java`;
    } else {
      fileName = `main${language.fileExtension}`;
    }
    const filePath = join(execDir, fileName);

    try {
      // Write source code to temp file
      writeFileSync(filePath, sourceCode, 'utf8');

      if (language.name === 'java') {
        return await this.executeJava(filePath, execDir, language);
      }

      if (language.name === 'cpp') {
        return await this.executeCpp(filePath, execDir, language);
      }

      // Resolve the command based on language
      const { command, args } = this.getCommand(language.name, filePath);

      // Execute with resource limits
      return await this.runProcess(command, args, {
        timeoutMs: language.maxTimeoutMs,
        maxMemoryKb: language.maxMemoryKb,
        cwd: execDir,
      });
    } finally {
      // Always cleanup — even on error
      this.cleanup(execDir);
    }
  }

  /**
   * Java: compile with javac, then run with java.
   */
  private async executeJava(filePath: string, execDir: string, language: LanguageConfig): Promise<SandboxResult> {
    // Step 1: Compile
    const compileResult = await this.runProcess('javac', [filePath], {
      timeoutMs: language.maxTimeoutMs,
      maxMemoryKb: language.maxMemoryKb,
      cwd: execDir,
    });
    if (compileResult.exitCode !== 0) {
      return compileResult; // Return compile errors
    }

    // Step 2: Run — class name is filename without extension
    const className = filePath.replace(/.*[/\\]/, '').replace('.java', '');
    return this.runProcess('java', ['-cp', '.', className], {
      timeoutMs: language.maxTimeoutMs,
      maxMemoryKb: language.maxMemoryKb,
      cwd: execDir,
    });
  }

  /**
   * C++: compile with g++, then run the binary.
   */
  private async executeCpp(filePath: string, execDir: string, language: LanguageConfig): Promise<SandboxResult> {
    const outPath = join(execDir, 'a.out');
    // Step 1: Compile
    const compileResult = await this.runProcess('g++', ['-o', outPath, filePath], {
      timeoutMs: language.maxTimeoutMs,
      maxMemoryKb: language.maxMemoryKb,
      cwd: execDir,
    });
    if (compileResult.exitCode !== 0) {
      return compileResult;
    }

    // Step 2: Run
    return this.runProcess(outPath, [], {
      timeoutMs: language.maxTimeoutMs,
      maxMemoryKb: language.maxMemoryKb,
      cwd: execDir,
    });
  }

  /**
   * Resolve runtime command for each supported language.
   */
  private getCommand(language: string, filePath: string): { command: string; args: string[] } {
    const isWindows = process.platform === 'win32';
    switch (language) {
      case 'python':
        return { command: isWindows ? 'python' : 'python3', args: ['-u', filePath] };
      case 'javascript':
        return { command: 'node', args: ['--max-old-space-size=256', filePath] };
      case 'java':
        // Java requires compile + run (simplified for demo)
        return { command: 'java', args: [filePath] };
      case 'cpp':
        // Would need compile step in production
        return { command: 'g++', args: ['-o', `${filePath}.out`, filePath] };
      default:
        throw new Error(`Unsupported language: ${language}`);
    }
  }

  /**
   * Spawn process with hard timeout and output capture.
   */
  private runProcess(
    command: string,
    args: string[],
    opts: { timeoutMs: number; maxMemoryKb: number; cwd: string }
  ): Promise<SandboxResult> {
    return new Promise((resolve) => {
      const startTime = Date.now();
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      let killed = false;

      const proc = spawn(command, args, {
        cwd: opts.cwd,
        timeout: opts.timeoutMs,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          PATH: process.env.PATH,
          HOME: opts.cwd,
          LANG: 'en_US.UTF-8',
          // Minimal env — no secrets leaked
        },
      });

      // Hard timeout with SIGKILL — cannot be trapped by user code
      const killTimer = setTimeout(() => {
        timedOut = true;
        killed = true;
        proc.kill('SIGKILL');
      }, opts.timeoutMs);

      // Capture stdout with size limit
      proc.stdout.on('data', (chunk: Buffer) => {
        if (Buffer.byteLength(stdout, 'utf8') < config.EXEC_MAX_OUTPUT_BYTES) {
          stdout += chunk.toString('utf8');
        }
      });

      // Capture stderr with size limit
      proc.stderr.on('data', (chunk: Buffer) => {
        if (Buffer.byteLength(stderr, 'utf8') < config.EXEC_MAX_OUTPUT_BYTES) {
          stderr += chunk.toString('utf8');
        }
      });

      proc.on('close', (code) => {
        clearTimeout(killTimer);
        const executionTimeMs = Date.now() - startTime;

        resolve({
          stdout: sanitizeOutput(stdout, config.EXEC_MAX_OUTPUT_BYTES),
          stderr: sanitizeOutput(stderr, config.EXEC_MAX_OUTPUT_BYTES),
          exitCode: timedOut ? -1 : (code ?? 1),
          executionTimeMs,
          memoryUsedKb: 0, // Real measurement requires cgroup integration
          timedOut,
        });
      });

      proc.on('error', (err) => {
        clearTimeout(killTimer);
        resolve({
          stdout: '',
          stderr: `Execution error: ${err.message}`,
          exitCode: 1,
          executionTimeMs: Date.now() - startTime,
          memoryUsedKb: 0,
          timedOut: false,
        });
      });
    });
  }

  /**
   * Remove temporary execution directory.
   */
  private cleanup(dir: string) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Non-critical — worst case /tmp gets cleaned by OS
    }
  }
}

export const sandboxService = new SandboxService();
