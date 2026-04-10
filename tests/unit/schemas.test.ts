import { describe, it, expect } from 'vitest';
import {
  createSessionSchema,
  updateSessionSchema,
  sessionParamsSchema,
  executionParamsSchema,
} from '../../src/types/schemas';

describe('createSessionSchema', () => {
  const validInput = {
    simulation_id: '550e8400-e29b-41d4-a716-446655440000',
    user_id: '660e8400-e29b-41d4-a716-446655440001',
    language: 'python',
    template_code: '# code here',
  };

  it('should accept valid input', () => {
    const result = createSessionSchema.safeParse(validInput);
    expect(result.success).toBe(true);
  });

  it('should default template_code to empty string', () => {
    const { template_code, ...input } = validInput;
    const result = createSessionSchema.parse(input);
    expect(result.template_code).toBe('');
  });

  it('should reject invalid UUID for simulation_id', () => {
    const result = createSessionSchema.safeParse({ ...validInput, simulation_id: 'not-uuid' });
    expect(result.success).toBe(false);
  });

  it('should reject invalid UUID for user_id', () => {
    const result = createSessionSchema.safeParse({ ...validInput, user_id: 'not-uuid' });
    expect(result.success).toBe(false);
  });

  it('should reject empty language', () => {
    const result = createSessionSchema.safeParse({ ...validInput, language: '' });
    expect(result.success).toBe(false);
  });

  it('should reject language longer than 20 chars', () => {
    const result = createSessionSchema.safeParse({ ...validInput, language: 'a'.repeat(21) });
    expect(result.success).toBe(false);
  });

  it('should reject template_code larger than 50KB', () => {
    const result = createSessionSchema.safeParse({ ...validInput, template_code: 'x'.repeat(51201) });
    expect(result.success).toBe(false);
  });
});

describe('updateSessionSchema', () => {
  it('should accept valid input', () => {
    const result = updateSessionSchema.safeParse({ source_code: 'print("hi")', version: 1 });
    expect(result.success).toBe(true);
  });

  it('should reject missing version', () => {
    const result = updateSessionSchema.safeParse({ source_code: 'print("hi")' });
    expect(result.success).toBe(false);
  });

  it('should reject version <= 0', () => {
    const result = updateSessionSchema.safeParse({ source_code: 'code', version: 0 });
    expect(result.success).toBe(false);
  });

  it('should reject non-integer version', () => {
    const result = updateSessionSchema.safeParse({ source_code: 'code', version: 1.5 });
    expect(result.success).toBe(false);
  });

  it('should reject source_code larger than 50KB', () => {
    const result = updateSessionSchema.safeParse({ source_code: 'x'.repeat(51201), version: 1 });
    expect(result.success).toBe(false);
  });
});

describe('sessionParamsSchema', () => {
  it('should accept valid UUID', () => {
    const result = sessionParamsSchema.safeParse({ session_id: '550e8400-e29b-41d4-a716-446655440000' });
    expect(result.success).toBe(true);
  });

  it('should reject non-UUID', () => {
    const result = sessionParamsSchema.safeParse({ session_id: 'abc123' });
    expect(result.success).toBe(false);
  });
});

describe('executionParamsSchema', () => {
  it('should accept valid UUID', () => {
    const result = executionParamsSchema.safeParse({ execution_id: '550e8400-e29b-41d4-a716-446655440000' });
    expect(result.success).toBe(true);
  });

  it('should reject non-UUID', () => {
    const result = executionParamsSchema.safeParse({ execution_id: 'invalid' });
    expect(result.success).toBe(false);
  });
});
