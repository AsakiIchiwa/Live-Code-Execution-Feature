import { describe, it, expect } from 'vitest';
import { generateIdempotencyKey, sanitizeOutput, AppError } from '../../src/utils/helpers';

describe('generateIdempotencyKey', () => {
  it('should generate consistent hash for same inputs', () => {
    const key1 = generateIdempotencyKey('session-1', 'snap-1', 'user-1');
    const key2 = generateIdempotencyKey('session-1', 'snap-1', 'user-1');
    expect(key1).toBe(key2);
  });

  it('should generate different hash for different inputs', () => {
    const key1 = generateIdempotencyKey('session-1', 'snap-1', 'user-1');
    const key2 = generateIdempotencyKey('session-1', 'snap-2', 'user-1');
    expect(key1).not.toBe(key2);
  });

  it('should return 64-character hex string', () => {
    const key = generateIdempotencyKey('a', 'b', 'c');
    expect(key).toHaveLength(64);
    expect(key).toMatch(/^[a-f0-9]+$/);
  });

  it('should produce different keys when user differs', () => {
    const key1 = generateIdempotencyKey('session-1', 'snap-1', 'user-1');
    const key2 = generateIdempotencyKey('session-1', 'snap-1', 'user-2');
    expect(key1).not.toBe(key2);
  });
});

describe('sanitizeOutput', () => {
  it('should strip ANSI escape codes', () => {
    const input = '\x1b[31mError\x1b[0m: something failed';
    const result = sanitizeOutput(input, 1024);
    expect(result).toBe('Error: something failed');
  });

  it('should strip control characters except newline and tab', () => {
    const input = 'hello\x00\x01\x02world\n\tnext';
    const result = sanitizeOutput(input, 1024);
    expect(result).toBe('helloworld\n\tnext');
  });

  it('should truncate output exceeding max bytes', () => {
    const input = 'A'.repeat(2000);
    const result = sanitizeOutput(input, 100);
    expect(Buffer.byteLength(result, 'utf8')).toBeLessThanOrEqual(150); // 100 + truncation message
    expect(result).toContain('...[output truncated]');
  });

  it('should return empty string for empty input', () => {
    expect(sanitizeOutput('', 1024)).toBe('');
  });

  it('should preserve normal output', () => {
    const input = 'Hello World\nLine 2\n';
    expect(sanitizeOutput(input, 1024)).toBe(input);
  });

  it('should handle unicode correctly', () => {
    const input = 'Xin chào thế giới 🌍';
    const result = sanitizeOutput(input, 1024);
    expect(result).toBe(input);
  });
});

describe('AppError', () => {
  it('should create error with statusCode and message', () => {
    const err = new AppError(404, 'Not found');
    expect(err.statusCode).toBe(404);
    expect(err.message).toBe('Not found');
    expect(err.name).toBe('AppError');
  });

  it('should support optional error code', () => {
    const err = new AppError(400, 'Bad request', 'INVALID_INPUT');
    expect(err.code).toBe('INVALID_INPUT');
  });

  it('should be instance of Error', () => {
    const err = new AppError(500, 'Internal');
    expect(err).toBeInstanceOf(Error);
  });
});
