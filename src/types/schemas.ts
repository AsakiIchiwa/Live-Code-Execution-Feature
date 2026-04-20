import { z } from 'zod';

// ─── Auth ───
export const registerSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(6).max(100),
  display_name: z.string().min(1).max(100).optional(),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const deviceLoginSchema = z.object({
  device_id: z.string().min(1).max(255),
});

export const googleLoginSchema = z.object({
  id_token: z.string().min(1),
});

export const githubLoginSchema = z.object({
  code: z.string().min(1),
  redirect_uri: z.string().min(1).optional(),
});

export const facebookLoginSchema = z.object({
  access_token: z.string().min(1),
});

export const updateProfileSchema = z.object({
  display_name: z.string().min(1).max(100).optional(),
  avatar_url: z.string().url().max(500).optional(),
  preferred_language: z.string().max(20).optional(),
});

export const updateSettingsSchema = z.object({
  default_language: z.string().max(20).optional(),
  editor_theme: z.string().max(30).optional(),
  font_size: z.number().int().min(8).max(32).optional(),
  auto_save: z.boolean().optional(),
  preferred_mode: z.string().max(20).optional(),
});

// ─── Code Session ───
export const createSessionSchema = z.object({
  simulation_id: z.string().uuid().optional(),
  user_id: z.string().uuid().optional(), // kept for backward compat, overridden by auth
  language: z.string().min(1).max(20),
  template_code: z.string().max(51200).default(''),
  title: z.string().max(200).default('Untitled'),
  mode: z.enum(['playground', 'study']).default('playground'),
  lesson_id: z.string().uuid().optional(),
});

export const updateSessionSchema = z.object({
  source_code: z.string().max(51200).optional(),
  title: z.string().max(200).optional(),
  version: z.number().int().positive(),
});

export const listSessionsQuerySchema = z.object({
  mode: z.enum(['playground', 'study']).optional(),
  language: z.string().optional(),
  lesson_id: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export const runCodeSchema = z.object({
  user_id: z.string().uuid().optional(),
});

// ─── Params ───
export const sessionParamsSchema = z.object({
  session_id: z.string().uuid(),
});

export const executionParamsSchema = z.object({
  execution_id: z.string().uuid(),
});

export const packIdParamsSchema = z.object({
  pack_id: z.string().uuid(),
});

export const lessonIdParamsSchema = z.object({
  lesson_id: z.string().uuid(),
});

export const submissionIdParamsSchema = z.object({
  submission_id: z.string().uuid(),
});

export const testCaseIdParamsSchema = z.object({
  test_case_id: z.string().uuid(),
});

// ─── Lesson Packs Query ───
export const listLessonPacksQuerySchema = z.object({
  language: z.string().optional(),
  difficulty: z.enum(['BEGINNER', 'INTERMEDIATE', 'ADVANCED']).optional(),
  free_only: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

// ─── Submission ───
export const submitLessonSchema = z.object({
  source_code: z.string().max(51200),
  language: z.string().min(1).max(20),
  session_id: z.string().uuid().optional(),
});

// ─── Admin: Language Pack ───
export const createLanguagePackSchema = z.object({
  code: z.string().min(1).max(20),
  name: z.string().min(1).max(50),
  description: z.string().max(5000).default(''),
  version: z.string().max(20).default('1.0.0'),
  icon_url: z.string().url().max(500).optional(),
  is_builtin: z.boolean().default(false),
  is_free: z.boolean().default(true),
  supported_features: z.array(z.string()).default([]),
  manifest: z.record(z.unknown()).default({}),
});

export const updateLanguagePackSchema = createLanguagePackSchema.partial();

// ─── Admin: Lesson Pack ───
export const createLessonPackSchema = z.object({
  language_pack_id: z.string().uuid(),
  title: z.string().min(1).max(200),
  description: z.string().max(5000).default(''),
  difficulty: z.enum(['BEGINNER', 'INTERMEDIATE', 'ADVANCED']).default('BEGINNER'),
  version: z.string().max(20).default('1.0.0'),
  order_index: z.number().int().default(0),
  is_free: z.boolean().default(true),
  icon_url: z.string().url().max(500).optional(),
  estimated_time: z.number().int().default(0),
});

export const updateLessonPackSchema = createLessonPackSchema.partial();

// ─── Admin: Lesson ───
export const createLessonSchema = z.object({
  lesson_pack_id: z.string().uuid(),
  title: z.string().min(1).max(200),
  description: z.string().max(5000).default(''),
  instructions: z.string().max(10000).default(''),
  starter_code: z.string().max(51200).default(''),
  expected_output: z.string().max(51200).optional(),
  difficulty: z.enum(['BEGINNER', 'INTERMEDIATE', 'ADVANCED']).default('BEGINNER'),
  lesson_type: z.enum(['TUTORIAL', 'EXERCISE', 'CHALLENGE', 'QUIZ']).default('EXERCISE'),
  estimated_time: z.number().int().default(10),
  order_index: z.number().int().default(0),
});

export const updateLessonSchema = createLessonSchema.partial();

// ─── Admin: Test Case ───
export const createTestCaseSchema = z.object({
  input: z.string().max(51200).default(''),
  expected: z.string().max(51200),
  is_public: z.boolean().default(false),
  is_hidden: z.boolean().default(false),
  order_index: z.number().int().default(0),
  description: z.string().max(500).optional(),
});

export const updateTestCaseSchema = createTestCaseSchema.partial();

// ─── Derived Types ───
export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type DeviceLoginInput = z.infer<typeof deviceLoginSchema>;
export type GoogleLoginInput = z.infer<typeof googleLoginSchema>;
export type GithubLoginInput = z.infer<typeof githubLoginSchema>;
export type FacebookLoginInput = z.infer<typeof facebookLoginSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;
export type CreateSessionInput = z.infer<typeof createSessionSchema>;
export type UpdateSessionInput = z.infer<typeof updateSessionSchema>;
export type ListSessionsQuery = z.infer<typeof listSessionsQuerySchema>;
export type RunCodeInput = z.infer<typeof runCodeSchema>;
export type SubmitLessonInput = z.infer<typeof submitLessonSchema>;
export type CreateLanguagePackInput = z.infer<typeof createLanguagePackSchema>;
export type UpdateLanguagePackInput = z.infer<typeof updateLanguagePackSchema>;
export type CreateLessonPackInput = z.infer<typeof createLessonPackSchema>;
export type UpdateLessonPackInput = z.infer<typeof updateLessonPackSchema>;
export type CreateLessonInput = z.infer<typeof createLessonSchema>;
export type UpdateLessonInput = z.infer<typeof updateLessonSchema>;
export type CreateTestCaseInput = z.infer<typeof createTestCaseSchema>;
export type UpdateTestCaseInput = z.infer<typeof updateTestCaseSchema>;
