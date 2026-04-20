import { FastifyInstance } from 'fastify';
import { sessionController } from '../controllers/sessionController';
import { executionController } from '../controllers/executionController';
import { executionQueue, redis, prisma } from '../config';
import { authGuard, adminGuard, creatorGuard, getCurrentUserId } from '../middlewares/authGuard';
import {
  authService, userSettingsService, languagePackService,
  lessonPackService, submissionService, progressService, adminService, marketplaceService,
} from '../services';
import {
  registerSchema, loginSchema, deviceLoginSchema, googleLoginSchema,
  githubLoginSchema, facebookLoginSchema, updateProfileSchema,
  updateSettingsSchema, packIdParamsSchema, lessonIdParamsSchema,
  submissionIdParamsSchema, testCaseIdParamsSchema, submitLessonSchema,
  listLessonPacksQuerySchema, createLanguagePackSchema, updateLanguagePackSchema,
  createLessonPackSchema, updateLessonPackSchema, createLessonSchema,
  updateLessonSchema, createTestCaseSchema, updateTestCaseSchema,
} from '../types/schemas';

export async function registerRoutes(app: FastifyInstance) {

  // ═══════════════════════════════════════════
  // HEALTH
  // ═══════════════════════════════════════════

  app.get('/health', {
    schema: { tags: ['Health'], description: 'Health check' },
  }, async () => ({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  }));

  app.get('/health/worker', {
    schema: { tags: ['Health'], description: 'Worker health check' },
  }, async () => {
    let status: 'ok' | 'degraded' = 'ok';
    const result: Record<string, unknown> = { status: 'ok', timestamp: new Date().toISOString() };

    try {
      const counts = await executionQueue.getJobCounts();
      result.queue = { waiting: counts.waiting ?? 0, active: counts.active ?? 0, completed: counts.completed ?? 0, failed: counts.failed ?? 0 };
    } catch { status = 'degraded'; result.queue = { error: 'unavailable' }; }

    try { await redis.ping(); result.redis = 'connected'; }
    catch { status = 'degraded'; result.redis = 'error'; }

    try { await prisma.$queryRaw`SELECT 1`; result.database = 'connected'; }
    catch { status = 'degraded'; result.database = 'error'; }

    result.status = status;
    return result;
  });

  // ═══════════════════════════════════════════
  // I. AUTH
  // ═══════════════════════════════════════════

  app.post('/api/v1/auth/register', {
    schema: { tags: ['Auth'], description: 'Register a new account' },
  }, async (req, rep) => {
    const body = registerSchema.parse(req.body);
    const result = await authService.register(body);
    return rep.status(201).send(result);
  });

  app.post('/api/v1/auth/login', {
    schema: { tags: ['Auth'], description: 'Login with email/password' },
  }, async (req, rep) => {
    const body = loginSchema.parse(req.body);
    const result = await authService.login(body);
    return rep.send(result);
  });

  app.post('/api/v1/auth/device-login', {
    schema: { tags: ['Auth'], description: 'Login with device ID (anonymous)' },
  }, async (req, rep) => {
    const body = deviceLoginSchema.parse(req.body);
    const result = await authService.deviceLogin(body);
    return rep.send(result);
  });

  app.post('/api/v1/auth/google-login', {
    schema: { tags: ['Auth'], description: 'Login with Google ID token' },
  }, async (req, rep) => {
    const body = googleLoginSchema.parse(req.body);
    const result = await authService.googleLogin(body);
    return rep.send(result);
  });

  app.post('/api/v1/auth/github-login', {
    schema: { tags: ['Auth'], description: 'Login with GitHub OAuth code' },
  }, async (req, rep) => {
    const body = githubLoginSchema.parse(req.body);
    const result = await authService.githubLogin(body);
    return rep.send(result);
  });

  app.post('/api/v1/auth/facebook-login', {
    schema: { tags: ['Auth'], description: 'Login with Facebook access token' },
  }, async (req, rep) => {
    const body = facebookLoginSchema.parse(req.body);
    const result = await authService.facebookLogin(body);
    return rep.send(result);
  });

  app.post('/api/v1/auth/refresh', {
    schema: { tags: ['Auth'], description: 'Refresh access token' },
  }, async (req, rep) => {
    const { refresh_token } = req.body as any;
    if (!refresh_token) return rep.status(400).send({ error: 'VALIDATION_ERROR', message: 'refresh_token required' });
    const result = await authService.refresh(refresh_token);
    return rep.send(result);
  });

  app.post('/api/v1/auth/logout', {
    schema: { tags: ['Auth'], description: 'Logout (revoke refresh token)' },
  }, async (req, rep) => {
    const { refresh_token } = req.body as any;
    if (refresh_token) await authService.logout(refresh_token);
    return rep.send({ message: 'Logged out' });
  });

  app.get('/api/v1/auth/me', {
    schema: { tags: ['Auth'], description: 'Get current user' },
    preHandler: [authGuard],
  }, async (req, rep) => {
    const userId = getCurrentUserId(req);
    const user = await authService.getMe(userId);
    return rep.send(user);
  });

  app.patch('/api/v1/users/me', {
    schema: { tags: ['Auth'], description: 'Update profile' },
    preHandler: [authGuard],
  }, async (req, rep) => {
    const userId = getCurrentUserId(req);
    const body = updateProfileSchema.parse(req.body);
    const result = await authService.updateProfile(userId, body);
    return rep.send(result);
  });

  // ═══════════════════════════════════════════
  // II. USER SETTINGS
  // ═══════════════════════════════════════════

  app.get('/api/v1/users/me/settings', {
    schema: { tags: ['Settings'], description: 'Get user settings' },
    preHandler: [authGuard],
  }, async (req, rep) => {
    const userId = getCurrentUserId(req);
    return rep.send(await userSettingsService.get(userId));
  });

  app.patch('/api/v1/users/me/settings', {
    schema: { tags: ['Settings'], description: 'Update user settings' },
    preHandler: [authGuard],
  }, async (req, rep) => {
    const userId = getCurrentUserId(req);
    const body = updateSettingsSchema.parse(req.body);
    return rep.send(await userSettingsService.update(userId, body));
  });

  // ═══════════════════════════════════════════
  // III. LANGUAGE PACKS
  // ═══════════════════════════════════════════

  app.get('/api/v1/language-packs', {
    schema: { tags: ['Language Packs'], description: 'List all available language packs' },
  }, async (_req, rep) => {
    return rep.send(await languagePackService.list());
  });

  app.get('/api/v1/language-packs/:pack_id', {
    schema: { tags: ['Language Packs'], description: 'Get language pack details' },
  }, async (req, rep) => {
    const { pack_id } = packIdParamsSchema.parse(req.params);
    return rep.send(await languagePackService.getById(pack_id));
  });

  app.post('/api/v1/language-packs/:pack_id/unlock', {
    schema: { tags: ['Language Packs'], description: 'Unlock a language pack' },
    preHandler: [authGuard],
  }, async (req, rep) => {
    const userId = getCurrentUserId(req);
    const { pack_id } = packIdParamsSchema.parse(req.params);
    return rep.send(await languagePackService.unlock(userId, pack_id));
  });

  app.post('/api/v1/language-packs/:pack_id/install', {
    schema: { tags: ['Language Packs'], description: 'Install a language pack' },
    preHandler: [authGuard],
  }, async (req, rep) => {
    const userId = getCurrentUserId(req);
    const { pack_id } = packIdParamsSchema.parse(req.params);
    return rep.send(await languagePackService.install(userId, pack_id));
  });

  app.get('/api/v1/users/me/language-packs', {
    schema: { tags: ['Language Packs'], description: 'Get user owned language packs' },
    preHandler: [authGuard],
  }, async (req, rep) => {
    const userId = getCurrentUserId(req);
    return rep.send(await languagePackService.getUserPacks(userId));
  });

  app.delete('/api/v1/users/me/language-packs/:pack_id', {
    schema: { tags: ['Language Packs'], description: 'Uninstall a language pack' },
    preHandler: [authGuard],
  }, async (req, rep) => {
    const userId = getCurrentUserId(req);
    const { pack_id } = packIdParamsSchema.parse(req.params);
    return rep.send(await languagePackService.uninstall(userId, pack_id));
  });

  app.get('/api/v1/language-packs/:pack_id/manifest', {
    schema: { tags: ['Language Packs'], description: 'Get language pack manifest' },
  }, async (req, rep) => {
    const { pack_id } = packIdParamsSchema.parse(req.params);
    return rep.send(await languagePackService.getManifest(pack_id));
  });

  // ═══════════════════════════════════════════
  // IV. LESSON PACKS
  // ═══════════════════════════════════════════

  app.get('/api/v1/lesson-packs', {
    schema: { tags: ['Lesson Packs'], description: 'List lesson packs' },
  }, async (req, rep) => {
    const query = listLessonPacksQuerySchema.parse(req.query);
    return rep.send(await lessonPackService.list(query));
  });

  app.get('/api/v1/lesson-packs/:pack_id', {
    schema: { tags: ['Lesson Packs'], description: 'Get lesson pack details' },
  }, async (req, rep) => {
    const { pack_id } = packIdParamsSchema.parse(req.params);
    return rep.send(await lessonPackService.getById(pack_id));
  });

  app.post('/api/v1/lesson-packs/:pack_id/unlock', {
    schema: { tags: ['Lesson Packs'], description: 'Unlock a lesson pack' },
    preHandler: [authGuard],
  }, async (req, rep) => {
    const userId = getCurrentUserId(req);
    const { pack_id } = packIdParamsSchema.parse(req.params);
    return rep.send(await lessonPackService.unlock(userId, pack_id));
  });

  app.get('/api/v1/users/me/lesson-packs', {
    schema: { tags: ['Lesson Packs'], description: 'Get user unlocked lesson packs' },
    preHandler: [authGuard],
  }, async (req, rep) => {
    const userId = getCurrentUserId(req);
    return rep.send(await lessonPackService.getUserPacks(userId));
  });

  app.get('/api/v1/lesson-packs/:pack_id/manifest', {
    schema: { tags: ['Lesson Packs'], description: 'Get lesson pack manifest' },
  }, async (req, rep) => {
    const { pack_id } = packIdParamsSchema.parse(req.params);
    return rep.send(await lessonPackService.getManifest(pack_id));
  });

  app.get('/api/v1/lesson-packs/:pack_id/lessons', {
    schema: { tags: ['Lesson Packs'], description: 'List lessons in pack' },
  }, async (req, rep) => {
    const { pack_id } = packIdParamsSchema.parse(req.params);
    return rep.send(await lessonPackService.getLessons(pack_id));
  });

  app.get('/api/v1/lessons/:lesson_id', {
    schema: { tags: ['Lesson Packs'], description: 'Get lesson details' },
  }, async (req, rep) => {
    const { lesson_id } = lessonIdParamsSchema.parse(req.params);
    return rep.send(await lessonPackService.getLesson(lesson_id));
  });

  // ═══════════════════════════════════════════
  // V. LESSON PROGRESS
  // ═══════════════════════════════════════════

  app.get('/api/v1/users/me/progress', {
    schema: { tags: ['Progress'], description: 'Get overall progress' },
    preHandler: [authGuard],
  }, async (req, rep) => {
    const userId = getCurrentUserId(req);
    return rep.send(await progressService.getOverview(userId));
  });

  app.get('/api/v1/users/me/progress/lesson-packs/:pack_id', {
    schema: { tags: ['Progress'], description: 'Get progress for a lesson pack' },
    preHandler: [authGuard],
  }, async (req, rep) => {
    const userId = getCurrentUserId(req);
    const { pack_id } = packIdParamsSchema.parse(req.params);
    return rep.send(await progressService.getPackProgress(userId, pack_id));
  });

  app.get('/api/v1/users/me/progress/lessons/:lesson_id', {
    schema: { tags: ['Progress'], description: 'Get progress for a lesson' },
    preHandler: [authGuard],
  }, async (req, rep) => {
    const userId = getCurrentUserId(req);
    const { lesson_id } = lessonIdParamsSchema.parse(req.params);
    return rep.send(await progressService.getLessonProgress(userId, lesson_id));
  });

  app.patch('/api/v1/users/me/progress/lessons/:lesson_id', {
    schema: { tags: ['Progress'], description: 'Update lesson progress status' },
    preHandler: [authGuard],
  }, async (req, rep) => {
    const userId = getCurrentUserId(req);
    const { lesson_id } = lessonIdParamsSchema.parse(req.params);
    const { status } = req.body as any;
    return rep.send(await progressService.updateLessonProgress(userId, lesson_id, status));
  });

  app.post('/api/v1/lessons/:lesson_id/complete', {
    schema: { tags: ['Progress'], description: 'Mark lesson as complete' },
    preHandler: [authGuard],
  }, async (req, rep) => {
    const userId = getCurrentUserId(req);
    const { lesson_id } = lessonIdParamsSchema.parse(req.params);
    return rep.send(await progressService.completeLesson(userId, lesson_id));
  });

  app.post('/api/v1/lessons/:lesson_id/unlock-next', {
    schema: { tags: ['Progress'], description: 'Unlock next lesson in sequence' },
    preHandler: [authGuard],
  }, async (req, rep) => {
    const userId = getCurrentUserId(req);
    const { lesson_id } = lessonIdParamsSchema.parse(req.params);
    return rep.send(await progressService.unlockNext(userId, lesson_id));
  });

  // ═══════════════════════════════════════════
  // VI. PLAYGROUND SESSIONS
  // ═══════════════════════════════════════════

  app.post('/api/v1/code-sessions', {
    schema: { tags: ['Sessions'], description: 'Create a new code session' },
    preHandler: [authGuard],
  }, (req, rep) => sessionController.create(req, rep));

  app.get('/api/v1/code-sessions', {
    schema: { tags: ['Sessions'], description: 'List user code sessions' },
    preHandler: [authGuard],
  }, (req, rep) => sessionController.list(req, rep));

  app.get('/api/v1/code-sessions/:session_id', {
    schema: { tags: ['Sessions'], description: 'Get session details' },
    preHandler: [authGuard],
  }, (req, rep) => sessionController.getById(req, rep));

  app.patch('/api/v1/code-sessions/:session_id', {
    schema: { tags: ['Sessions'], description: 'Update session (autosave)' },
    preHandler: [authGuard],
  }, (req, rep) => sessionController.autosave(req, rep));

  app.delete('/api/v1/code-sessions/:session_id', {
    schema: { tags: ['Sessions'], description: 'Delete (close) a session' },
    preHandler: [authGuard],
  }, (req, rep) => sessionController.delete(req, rep));

  app.post('/api/v1/code-sessions/:session_id/autosave', {
    schema: { tags: ['Sessions'], description: 'Autosave code explicitly' },
    preHandler: [authGuard],
  }, (req, rep) => sessionController.autosaveEndpoint(req, rep));

  app.post('/api/v1/code-sessions/:session_id/run', {
    schema: { tags: ['Executions'], description: 'Run code in session' },
    preHandler: [authGuard],
  }, (req, rep) => executionController.run(req, rep));

  app.get('/api/v1/executions/:execution_id', {
    schema: { tags: ['Executions'], description: 'Get execution result' },
  }, (req, rep) => executionController.getResult(req, rep));

  app.get('/api/v1/code-sessions/:session_id/executions', {
    schema: { tags: ['Executions'], description: 'List session executions' },
  }, (req, rep) => executionController.listBySession(req, rep));

  // ═══════════════════════════════════════════
  // VII. STUDY SUBMISSIONS / GRADING
  // ═══════════════════════════════════════════

  app.post('/api/v1/lessons/:lesson_id/submissions', {
    schema: { tags: ['Submissions'], description: 'Submit code for a lesson' },
    preHandler: [authGuard],
  }, async (req, rep) => {
    const userId = getCurrentUserId(req);
    const { lesson_id } = lessonIdParamsSchema.parse(req.params);
    const body = submitLessonSchema.parse(req.body);
    return rep.send(await submissionService.submit(userId, lesson_id, body));
  });

  app.get('/api/v1/submissions/:submission_id', {
    schema: { tags: ['Submissions'], description: 'Get submission details' },
    preHandler: [authGuard],
  }, async (req, rep) => {
    const { submission_id } = submissionIdParamsSchema.parse(req.params);
    return rep.send(await submissionService.getById(submission_id));
  });

  app.get('/api/v1/lessons/:lesson_id/submissions', {
    schema: { tags: ['Submissions'], description: 'List submissions for a lesson' },
    preHandler: [authGuard],
  }, async (req, rep) => {
    const userId = getCurrentUserId(req);
    const { lesson_id } = lessonIdParamsSchema.parse(req.params);
    return rep.send(await submissionService.listByLesson(userId, lesson_id));
  });

  app.post('/api/v1/submissions/:submission_id/recheck', {
    schema: { tags: ['Submissions'], description: 'Recheck a submission' },
    preHandler: [authGuard],
  }, async (req, rep) => {
    const { submission_id } = submissionIdParamsSchema.parse(req.params);
    return rep.send(await submissionService.recheck(submission_id));
  });

  app.get('/api/v1/submissions/:submission_id/result', {
    schema: { tags: ['Submissions'], description: 'Get detailed submission result' },
    preHandler: [authGuard],
  }, async (req, rep) => {
    const { submission_id } = submissionIdParamsSchema.parse(req.params);
    return rep.send(await submissionService.getResult(submission_id));
  });

  // ═══════════════════════════════════════════
  // VIII. TEST CASE / EVALUATION
  // ═══════════════════════════════════════════

  app.get('/api/v1/lessons/:lesson_id/test-summary', {
    schema: { tags: ['Tests'], description: 'Get test case summary (no secrets)' },
  }, async (req, rep) => {
    const { lesson_id } = lessonIdParamsSchema.parse(req.params);
    const tests = await prisma.testCase.findMany({
      where: { lessonId: lesson_id },
      select: { id: true, isPublic: true, description: true, orderIndex: true },
      orderBy: { orderIndex: 'asc' },
    });
    return rep.send({ total: tests.length, tests });
  });

  app.get('/api/v1/lessons/:lesson_id/public-tests', {
    schema: { tags: ['Tests'], description: 'Get public test cases' },
  }, async (req, rep) => {
    const { lesson_id } = lessonIdParamsSchema.parse(req.params);
    const tests = await prisma.testCase.findMany({
      where: { lessonId: lesson_id, isPublic: true },
      orderBy: { orderIndex: 'asc' },
    });
    return rep.send(tests);
  });

  app.post('/api/v1/lessons/:lesson_id/run-sample', {
    schema: { tags: ['Tests'], description: 'Run code with sample tests' },
    preHandler: [authGuard],
  }, async (req, rep) => {
    // Placeholder — would integrate with sandbox to run against public tests
    const { lesson_id } = lessonIdParamsSchema.parse(req.params);
    return rep.send({ message: 'Sample test run placeholder', lesson_id });
  });

  // ═══════════════════════════════════════════
  // IX. CONTENT DELIVERY
  // ═══════════════════════════════════════════

  app.get('/api/v1/content/banners', {
    schema: { tags: ['Content'], description: 'Get promotional banners' },
  }, async (_req, rep) => {
    return rep.send({ banners: [] });
  });

  app.get('/api/v1/downloads/language-packs/:pack_id', {
    schema: { tags: ['Content'], description: 'Get language pack download URL' },
  }, async (req, rep) => {
    const { pack_id } = packIdParamsSchema.parse(req.params);
    const manifest = await languagePackService.getManifest(pack_id);
    return rep.send({ pack_id, download_url: null, manifest });
  });

  app.get('/api/v1/downloads/lesson-packs/:pack_id', {
    schema: { tags: ['Content'], description: 'Get lesson pack download URL' },
  }, async (req, rep) => {
    const { pack_id } = packIdParamsSchema.parse(req.params);
    const manifest = await lessonPackService.getManifest(pack_id);
    return rep.send({ pack_id, download_url: null, manifest });
  });

  app.get('/api/v1/content/version', {
    schema: { tags: ['Content'], description: 'Get latest content version' },
  }, async (_req, rep) => {
    return rep.send({ version: '1.0.0', updated_at: new Date().toISOString() });
  });

  // ═══════════════════════════════════════════
  // X. ADMIN
  // ═══════════════════════════════════════════

  // Language Packs
  app.post('/api/v1/admin/language-packs', {
    schema: { tags: ['Admin'], description: 'Create language pack' },
    preHandler: [authGuard, adminGuard],
  }, async (req, rep) => {
    const body = createLanguagePackSchema.parse(req.body);
    return rep.status(201).send(await adminService.createLanguagePack(body));
  });

  app.patch('/api/v1/admin/language-packs/:pack_id', {
    schema: { tags: ['Admin'], description: 'Update language pack' },
    preHandler: [authGuard, adminGuard],
  }, async (req, rep) => {
    const { pack_id } = packIdParamsSchema.parse(req.params);
    const body = updateLanguagePackSchema.parse(req.body);
    return rep.send(await adminService.updateLanguagePack(pack_id, body));
  });

  app.post('/api/v1/admin/language-packs/:pack_id/publish', {
    schema: { tags: ['Admin'], description: 'Publish language pack' },
    preHandler: [authGuard, adminGuard],
  }, async (req, rep) => {
    const { pack_id } = packIdParamsSchema.parse(req.params);
    return rep.send(await adminService.publishLanguagePack(pack_id));
  });

  // Lesson Packs
  app.post('/api/v1/admin/lesson-packs', {
    schema: { tags: ['Admin'], description: 'Create lesson pack' },
    preHandler: [authGuard, adminGuard],
  }, async (req, rep) => {
    const body = createLessonPackSchema.parse(req.body);
    return rep.status(201).send(await adminService.createLessonPack(body));
  });

  app.patch('/api/v1/admin/lesson-packs/:pack_id', {
    schema: { tags: ['Admin'], description: 'Update lesson pack' },
    preHandler: [authGuard, adminGuard],
  }, async (req, rep) => {
    const { pack_id } = packIdParamsSchema.parse(req.params);
    const body = updateLessonPackSchema.parse(req.body);
    return rep.send(await adminService.updateLessonPack(pack_id, body));
  });

  app.post('/api/v1/admin/lesson-packs/:pack_id/publish', {
    schema: { tags: ['Admin'], description: 'Publish lesson pack' },
    preHandler: [authGuard, adminGuard],
  }, async (req, rep) => {
    const { pack_id } = packIdParamsSchema.parse(req.params);
    return rep.send(await adminService.publishLessonPack(pack_id));
  });

  // Lessons
  app.post('/api/v1/admin/lessons', {
    schema: { tags: ['Admin'], description: 'Create lesson' },
    preHandler: [authGuard, adminGuard],
  }, async (req, rep) => {
    const body = createLessonSchema.parse(req.body);
    return rep.status(201).send(await adminService.createLesson(body));
  });

  app.patch('/api/v1/admin/lessons/:lesson_id', {
    schema: { tags: ['Admin'], description: 'Update lesson' },
    preHandler: [authGuard, adminGuard],
  }, async (req, rep) => {
    const { lesson_id } = lessonIdParamsSchema.parse(req.params);
    const body = updateLessonSchema.parse(req.body);
    return rep.send(await adminService.updateLesson(lesson_id, body));
  });

  // Test Cases
  app.post('/api/v1/admin/lessons/:lesson_id/test-cases', {
    schema: { tags: ['Admin'], description: 'Create test case for lesson' },
    preHandler: [authGuard, adminGuard],
  }, async (req, rep) => {
    const { lesson_id } = lessonIdParamsSchema.parse(req.params);
    const body = createTestCaseSchema.parse(req.body);
    return rep.status(201).send(await adminService.createTestCase(lesson_id, body));
  });

  app.patch('/api/v1/admin/test-cases/:test_case_id', {
    schema: { tags: ['Admin'], description: 'Update test case' },
    preHandler: [authGuard, adminGuard],
  }, async (req, rep) => {
    const { test_case_id } = testCaseIdParamsSchema.parse(req.params);
    const body = updateTestCaseSchema.parse(req.body);
    return rep.send(await adminService.updateTestCase(test_case_id, body));
  });

  // Admin: Delete endpoints (soft delete)
  app.delete('/api/v1/admin/language-packs/:pack_id', {
    schema: { tags: ['Admin'], description: 'Soft delete language pack' },
    preHandler: [authGuard, adminGuard],
  }, async (req, rep) => {
    const { pack_id } = packIdParamsSchema.parse(req.params);
    return rep.send(await adminService.deleteLanguagePack(pack_id));
  });

  app.delete('/api/v1/admin/lesson-packs/:pack_id', {
    schema: { tags: ['Admin'], description: 'Soft delete lesson pack' },
    preHandler: [authGuard, adminGuard],
  }, async (req, rep) => {
    const { pack_id } = packIdParamsSchema.parse(req.params);
    return rep.send(await adminService.deleteLessonPack(pack_id));
  });

  app.delete('/api/v1/admin/lessons/:lesson_id', {
    schema: { tags: ['Admin'], description: 'Soft delete lesson' },
    preHandler: [authGuard, adminGuard],
  }, async (req, rep) => {
    const { lesson_id } = lessonIdParamsSchema.parse(req.params);
    return rep.send(await adminService.deleteLesson(lesson_id));
  });

  app.delete('/api/v1/admin/test-cases/:test_case_id', {
    schema: { tags: ['Admin'], description: 'Delete test case' },
    preHandler: [authGuard, adminGuard],
  }, async (req, rep) => {
    const { test_case_id } = testCaseIdParamsSchema.parse(req.params);
    await adminService.deleteTestCase(test_case_id);
    return rep.send({ message: 'Deleted' });
  });

  // Admin: Unpublish endpoints
  app.post('/api/v1/admin/language-packs/:pack_id/unpublish', {
    schema: { tags: ['Admin'], description: 'Unpublish language pack' },
    preHandler: [authGuard, adminGuard],
  }, async (req, rep) => {
    const { pack_id } = packIdParamsSchema.parse(req.params);
    return rep.send(await adminService.unpublishLanguagePack(pack_id));
  });

  app.post('/api/v1/admin/lesson-packs/:pack_id/unpublish', {
    schema: { tags: ['Admin'], description: 'Unpublish lesson pack' },
    preHandler: [authGuard, adminGuard],
  }, async (req, rep) => {
    const { pack_id } = packIdParamsSchema.parse(req.params);
    return rep.send(await adminService.unpublishLessonPack(pack_id));
  });

  // Admin: Role management
  app.post('/api/v1/admin/users/:user_id/promote-creator', {
    schema: { tags: ['Admin'], description: 'Promote user to CREATOR role' },
    preHandler: [authGuard, adminGuard],
  }, async (req, rep) => {
    const { user_id } = (req.params as any);
    return rep.send(await adminService.promoteToCreator(user_id));
  });

  app.post('/api/v1/admin/users/:user_id/demote', {
    schema: { tags: ['Admin'], description: 'Demote user to USER role' },
    preHandler: [authGuard, adminGuard],
  }, async (req, rep) => {
    const { user_id } = (req.params as any);
    return rep.send(await adminService.demoteToUser(user_id));
  });

  // Admin: Marketplace review
  app.get('/api/v1/admin/marketplace/pending', {
    schema: { tags: ['Admin'], description: 'List pending marketplace submissions' },
    preHandler: [authGuard, adminGuard],
  }, async (_req, rep) => {
    return rep.send(await marketplaceService.listPendingReviews());
  });

  app.post('/api/v1/admin/marketplace/:submission_id/approve', {
    schema: { tags: ['Admin'], description: 'Approve marketplace submission' },
    preHandler: [authGuard, adminGuard],
  }, async (req, rep) => {
    const { submission_id } = (req.params as any);
    const adminId = getCurrentUserId(req);
    return rep.send(await marketplaceService.approve(submission_id, adminId));
  });

  app.post('/api/v1/admin/marketplace/:submission_id/reject', {
    schema: { tags: ['Admin'], description: 'Reject marketplace submission' },
    preHandler: [authGuard, adminGuard],
  }, async (req, rep) => {
    const { submission_id } = (req.params as any);
    const adminId = getCurrentUserId(req);
    const { review_note } = (req.body as any) || {};
    return rep.send(await marketplaceService.reject(submission_id, adminId, review_note || ''));
  });

  app.post('/api/v1/admin/marketplace/:submission_id/suspend', {
    schema: { tags: ['Admin'], description: 'Suspend marketplace item' },
    preHandler: [authGuard, adminGuard],
  }, async (req, rep) => {
    const { submission_id } = (req.params as any);
    const adminId = getCurrentUserId(req);
    const { review_note } = (req.body as any) || {};
    return rep.send(await marketplaceService.suspend(submission_id, adminId, review_note || ''));
  });

  // ═══════════════════════════════════════════
  // XII. MARKETPLACE (Creator)
  // ═══════════════════════════════════════════

  app.post('/api/v1/marketplace/language-packs', {
    schema: { tags: ['Marketplace'], description: 'Creator: create language pack for marketplace' },
    preHandler: [authGuard, creatorGuard],
  }, async (req, rep) => {
    const creatorId = getCurrentUserId(req);
    const body = createLanguagePackSchema.parse(req.body);
    return rep.status(201).send(await marketplaceService.createLanguagePack(creatorId, body));
  });

  app.post('/api/v1/marketplace/lesson-packs', {
    schema: { tags: ['Marketplace'], description: 'Creator: create lesson pack for marketplace' },
    preHandler: [authGuard, creatorGuard],
  }, async (req, rep) => {
    const creatorId = getCurrentUserId(req);
    const body = createLessonPackSchema.parse(req.body);
    return rep.status(201).send(await marketplaceService.createLessonPack(creatorId, body));
  });

  app.get('/api/v1/marketplace/my-submissions', {
    schema: { tags: ['Marketplace'], description: 'Creator: list own submissions' },
    preHandler: [authGuard, creatorGuard],
  }, async (req, rep) => {
    const creatorId = getCurrentUserId(req);
    return rep.send(await marketplaceService.listMySubmissions(creatorId));
  });

  app.patch('/api/v1/marketplace/submissions/:submission_id', {
    schema: { tags: ['Marketplace'], description: 'Creator: update own submission' },
    preHandler: [authGuard, creatorGuard],
  }, async (req, rep) => {
    const creatorId = getCurrentUserId(req);
    const { submission_id } = (req.params as any);
    return rep.send(await marketplaceService.updateSubmission(submission_id, creatorId, req.body));
  });

  app.post('/api/v1/marketplace/submissions/:submission_id/submit', {
    schema: { tags: ['Marketplace'], description: 'Creator: submit for review' },
    preHandler: [authGuard, creatorGuard],
  }, async (req, rep) => {
    const creatorId = getCurrentUserId(req);
    const { submission_id } = (req.params as any);
    return rep.send(await marketplaceService.submitForReview(submission_id, creatorId));
  });

  // ═══════════════════════════════════════════
  // XIII. MARKETPLACE (Public)
  // ═══════════════════════════════════════════

  app.get('/api/v1/marketplace', {
    schema: { tags: ['Marketplace'], description: 'Browse published marketplace items' },
  }, async (req, rep) => {
    const query = req.query as any;
    return rep.send(await marketplaceService.browse(query));
  });

  app.get('/api/v1/marketplace/:submission_id', {
    schema: { tags: ['Marketplace'], description: 'Get marketplace item detail' },
  }, async (req, rep) => {
    const { submission_id } = (req.params as any);
    return rep.send(await marketplaceService.getItem(submission_id));
  });

  // ═══════════════════════════════════════════
  // XIV. SYSTEM / OPS
  // ═══════════════════════════════════════════

  app.get('/api/v1/system/status', {
    schema: { tags: ['System'], description: 'System status' },
  }, async (_req, rep) => {
    let dbOk = false;
    let redisOk = false;
    try { await prisma.$queryRaw`SELECT 1`; dbOk = true; } catch {}
    try { await redis.ping(); redisOk = true; } catch {}

    return rep.send({
      status: dbOk && redisOk ? 'ok' : 'degraded',
      database: dbOk ? 'connected' : 'disconnected',
      redis: redisOk ? 'connected' : 'disconnected',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/api/v1/system/supported-languages', {
    schema: { tags: ['System'], description: 'List active supported languages' },
  }, async (_req, rep) => {
    const languages = await prisma.supportedLanguage.findMany({
      where: { isActive: true },
      select: { id: true, name: true, version: true, fileExtension: true },
    });
    return rep.send(languages);
  });

  app.get('/api/v1/system/runtime-config', {
    schema: { tags: ['System'], description: 'Get runtime config for app' },
  }, async (_req, rep) => {
    return rep.send({
      max_code_size_bytes: 51200,
      max_execution_timeout_ms: 10000,
      supported_modes: ['playground', 'study'],
      default_language: 'java',
    });
  });
}
