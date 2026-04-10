import { createHash } from 'crypto';

/**
 * Generate SHA-256 idempotency key from composite parts.
 * Ensures the same session + snapshot + user cannot trigger duplicate executions.
 */
export function generateIdempotencyKey(
  sessionId: string,
  snapshotId: string,
  userId: string
): string {
  return createHash('sha256')
    .update(`${sessionId}:${snapshotId}:${userId}`)
    .digest('hex')
    .substring(0, 64);
}

/**
 * Strip ANSI escape codes and control characters from execution output.
 * Prevents XSS and terminal injection when returning output to clients.
 */
export function sanitizeOutput(output: string, maxBytes: number): string {
  // Strip ANSI escape sequences
  let cleaned = output.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
  // Strip control characters except newline and tab
  cleaned = cleaned.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
  // Truncate to max bytes
  if (Buffer.byteLength(cleaned, 'utf8') > maxBytes) {
    const buf = Buffer.from(cleaned, 'utf8');
    cleaned = buf.subarray(0, maxBytes).toString('utf8') + '\n...[output truncated]';
  }
  return cleaned;
}

/**
 * Custom error class with HTTP status code for API responses.
 */
export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code?: string
  ) {
    super(message);
    this.name = 'AppError';
  }
}
