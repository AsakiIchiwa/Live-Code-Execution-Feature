import { prisma, config } from '../config';
import { AppError } from '../utils/helpers';
import { CreateSessionInput, UpdateSessionInput } from '../types/schemas';

export class SessionService {
  /**
   * Create a new live coding session.
   * Validates language exists and is active, sets session TTL.
   */
  async create(input: CreateSessionInput) {
    // Validate language exists and is active
    const language = await prisma.supportedLanguage.findFirst({
      where: { name: input.language, isActive: true },
    });

    if (!language) {
      throw new AppError(400, `Language "${input.language}" is not supported or is disabled`, 'INVALID_LANGUAGE');
    }

    const expiresAt = new Date(Date.now() + config.SESSION_TTL_HOURS * 3600 * 1000);

    const session = await prisma.codeSession.create({
      data: {
        simulationId: input.simulation_id,
        userId: input.user_id,
        languageId: language.id,
        templateCode: input.template_code,
        sourceCode: input.template_code,
        expiresAt,
      },
      include: { language: true },
    });

    return {
      session_id: session.id,
      status: session.status,
      language: session.language.name,
      language_version: session.language.version,
      expires_at: session.expiresAt,
      created_at: session.createdAt,
    };
  }

  /**
   * Autosave code with optimistic locking.
   * Creates a snapshot for history tracking.
   * Rejects stale writes via version check.
   */
  async autosave(sessionId: string, input: UpdateSessionInput, userId: string) {
    const session = await this.getValidSession(sessionId, userId);

    // Optimistic locking: reject if version mismatch
    if (session.version !== input.version) {
      throw new AppError(409, 
        `Version conflict: expected ${session.version}, got ${input.version}. Refetch and retry.`,
        'VERSION_CONFLICT'
      );
    }

    // Transaction: update session + create snapshot atomically
    const [updated] = await prisma.$transaction([
      prisma.codeSession.update({
        where: { id: sessionId },
        data: {
          sourceCode: input.source_code,
          version: { increment: 1 },
        },
      }),
      prisma.codeSnapshot.create({
        data: {
          sessionId,
          sourceCode: input.source_code,
          version: session.version + 1,
        },
      }),
    ]);

    // Cleanup old snapshots beyond retention limit
    await this.cleanupSnapshots(sessionId);

    return {
      session_id: updated.id,
      status: updated.status,
      version: updated.version,
      updated_at: updated.updatedAt,
    };
  }

  /**
   * Get session by ID. Public method for controllers.
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
   * Validate session exists, is active, not expired, and owned by user.
   * Central authorization check — prevents accessing other users' sessions.
   */
  async getValidSession(sessionId: string, userId: string) {
    const session = await prisma.codeSession.findUnique({
      where: { id: sessionId },
      include: { language: true },
    });

    if (!session) {
      throw new AppError(404, 'Session not found', 'SESSION_NOT_FOUND');
    }

    // Ownership check — critical security gate
    if (session.userId !== userId) {
      throw new AppError(403, 'Access denied: you do not own this session', 'FORBIDDEN');
    }

    if (session.status !== 'ACTIVE') {
      throw new AppError(400, `Session is ${session.status}`, 'SESSION_NOT_ACTIVE');
    }

    // Check expiry
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
   * Keeps the most recent N snapshots per session.
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
        where: { id: { in: snapshots.map((s) => s.id) } },
      });
    }
  }
}

export const sessionService = new SessionService();
