import { prisma, config } from '../config';
import { AppError } from '../utils/helpers';
import { CreateSessionInput, UpdateSessionInput, ListSessionsQuery } from '../types/schemas';

export class SessionService {
  /**
   * Create a new live coding session.
   */
  async create(input: CreateSessionInput, userId: string) {
    const language = await prisma.supportedLanguage.findFirst({
      where: { name: input.language, isActive: true },
    });

    if (!language) {
      throw new AppError(400, `Language "${input.language}" is not supported or is disabled`, 'INVALID_LANGUAGE');
    }

    const expiresAt = new Date(Date.now() + config.SESSION_TTL_HOURS * 3600 * 1000);

    const session = await prisma.codeSession.create({
      data: {
        simulationId: input.simulation_id || null,
        userId,
        languageId: language.id,
        title: input.title || 'Untitled',
        templateCode: input.template_code,
        sourceCode: input.template_code,
        mode: input.mode === 'study' ? 'STUDY' : 'PLAYGROUND',
        lessonId: input.lesson_id || null,
        expiresAt,
      },
      include: { language: true },
    });

    return {
      session_id: session.id,
      title: session.title,
      mode: session.mode,
      status: session.status,
      language: session.language.name,
      language_version: session.language.version,
      expires_at: session.expiresAt,
      created_at: session.createdAt,
    };
  }

  /**
   * Autosave code with optimistic locking.
   */
  async autosave(sessionId: string, input: UpdateSessionInput, userId: string) {
    const session = await this.getValidSession(sessionId, userId);

    if (session.version !== input.version) {
      throw new AppError(409,
        `Version conflict: expected ${session.version}, got ${input.version}. Refetch and retry.`,
        'VERSION_CONFLICT'
      );
    }

    const updateData: any = { version: { increment: 1 } };
    if (input.source_code !== undefined) updateData.sourceCode = input.source_code;
    if (input.title !== undefined) updateData.title = input.title;

    const [updated] = await prisma.$transaction([
      prisma.codeSession.update({
        where: { id: sessionId },
        data: updateData,
      }),
      prisma.codeSnapshot.create({
        data: {
          sessionId,
          sourceCode: input.source_code || session.sourceCode,
          version: session.version + 1,
        },
      }),
    ]);

    await this.cleanupSnapshots(sessionId);

    return {
      session_id: updated.id,
      status: updated.status,
      version: updated.version,
      updated_at: updated.updatedAt,
    };
  }

  /**
   * List sessions for a user.
   */
  async listByUser(userId: string, query: ListSessionsQuery) {
    const where: any = { userId };
    if (query.mode) where.mode = query.mode.toUpperCase();
    if (query.language) where.language = { name: query.language };
    if (query.lesson_id) where.lessonId = query.lesson_id;

    const [sessions, total] = await Promise.all([
      prisma.codeSession.findMany({
        where,
        include: { language: { select: { name: true, version: true } } },
        orderBy: { updatedAt: 'desc' },
        take: query.limit,
        skip: query.offset,
      }),
      prisma.codeSession.count({ where }),
    ]);

    return {
      sessions: sessions.map(s => ({
        session_id: s.id,
        title: s.title,
        mode: s.mode,
        language: s.language.name,
        status: s.status,
        version: s.version,
        updated_at: s.updatedAt,
        created_at: s.createdAt,
      })),
      total,
    };
  }

  /**
   * Get session by ID.
   */
  async getById(sessionId: string) {
    const session = await prisma.codeSession.findUnique({
      where: { id: sessionId },
      include: { language: true },
    });

    if (!session) {
      throw new AppError(404, 'Session not found', 'SESSION_NOT_FOUND');
    }

    return session;
  }

  /**
   * Delete a session.
   */
  async delete(sessionId: string, userId: string) {
    const session = await this.getValidSession(sessionId, userId);
    await prisma.codeSession.update({
      where: { id: sessionId },
      data: { status: 'CLOSED' },
    });
    return { message: 'Session closed' };
  }

  /**
   * Validate session exists, is active, not expired, and owned by user.
   */
  async getValidSession(sessionId: string, userId: string) {
    const session = await prisma.codeSession.findUnique({
      where: { id: sessionId },
      include: { language: true },
    });

    if (!session) {
      throw new AppError(404, 'Session not found', 'SESSION_NOT_FOUND');
    }

    if (session.userId !== userId) {
      throw new AppError(403, 'Access denied: you do not own this session', 'FORBIDDEN');
    }

    if (session.status !== 'ACTIVE') {
      throw new AppError(400, `Session is ${session.status}`, 'SESSION_NOT_ACTIVE');
    }

    if (session.expiresAt && new Date() > session.expiresAt) {
      await prisma.codeSession.update({
        where: { id: sessionId },
        data: { status: 'EXPIRED' },
      });
      throw new AppError(400, 'Session has expired', 'SESSION_EXPIRED');
    }

    return session;
  }

  /**
   * Remove old snapshots beyond retention limit.
   */
  private async cleanupSnapshots(sessionId: string) {
    const snapshots = await prisma.codeSnapshot.findMany({
      where: { sessionId },
      orderBy: { version: 'desc' },
      skip: config.SESSION_MAX_SNAPSHOTS,
      select: { id: true },
    });

    if (snapshots.length > 0) {
      await prisma.codeSnapshot.deleteMany({
        where: { id: { in: snapshots.map(s => s.id) } },
      });
    }
  }
}

export const sessionService = new SessionService();
