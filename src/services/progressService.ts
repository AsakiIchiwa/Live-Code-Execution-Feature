import { prisma } from '../config';
import { AppError } from '../utils/helpers';

export class ProgressService {
  /**
   * Get overall progress summary for user.
   */
  async getOverview(userId: string) {
    const [totalCompleted, totalInProgress, allProgress] = await Promise.all([
      prisma.lessonProgress.count({ where: { userId, status: 'COMPLETED' } }),
      prisma.lessonProgress.count({ where: { userId, status: 'IN_PROGRESS' } }),
      prisma.lessonProgress.findMany({
        where: { userId },
        select: { lessonId: true, status: true, bestScore: true, completedAt: true },
      }),
    ]);

    return {
      total_completed: totalCompleted,
      total_in_progress: totalInProgress,
      total_lessons_touched: allProgress.length,
    };
  }

  /**
   * Get progress for a specific lesson pack.
   */
  async getPackProgress(userId: string, packId: string) {
    const pack = await prisma.lessonPack.findUnique({ where: { id: packId } });
    if (!pack) throw new AppError(404, 'Lesson pack not found', 'PACK_NOT_FOUND');

    const lessons = await prisma.lesson.findMany({
      where: { lessonPackId: packId },
      select: { id: true },
    });
    const lessonIds = lessons.map(l => l.id);

    const progress = await prisma.lessonProgress.findMany({
      where: { userId, lessonId: { in: lessonIds } },
    });

    const completed = progress.filter(p => p.status === 'COMPLETED').length;
    const total = lessonIds.length;

    return {
      pack_id: packId,
      total_lessons: total,
      completed_lessons: completed,
      progress_percent: total > 0 ? Math.round((completed / total) * 100) : 0,
      lessons: progress.map(p => ({
        lesson_id: p.lessonId,
        status: p.status,
        best_score: p.bestScore,
        attempts: p.attempts,
        completed_at: p.completedAt,
      })),
    };
  }

  /**
   * Get progress for a specific lesson.
   */
  async getLessonProgress(userId: string, lessonId: string) {
    const progress = await prisma.lessonProgress.findUnique({
      where: { userId_lessonId: { userId, lessonId } },
    });

    if (!progress) {
      return { lesson_id: lessonId, status: 'NOT_STARTED', best_score: 0, attempts: 0 };
    }

    return {
      lesson_id: progress.lessonId,
      status: progress.status,
      best_score: progress.bestScore,
      attempts: progress.attempts,
      completed_at: progress.completedAt,
      last_active_at: progress.lastActiveAt,
    };
  }

  /**
   * Update lesson progress status manually.
   */
  async updateLessonProgress(userId: string, lessonId: string, status: string) {
    return prisma.lessonProgress.upsert({
      where: { userId_lessonId: { userId, lessonId } },
      update: { status: status as any, lastActiveAt: new Date() },
      create: { userId, lessonId, status: status as any, lastActiveAt: new Date() },
    });
  }

  /**
   * Mark lesson complete.
   */
  async completeLesson(userId: string, lessonId: string) {
    return prisma.lessonProgress.upsert({
      where: { userId_lessonId: { userId, lessonId } },
      update: { status: 'COMPLETED', completedAt: new Date(), lastActiveAt: new Date() },
      create: { userId, lessonId, status: 'COMPLETED', completedAt: new Date(), lastActiveAt: new Date() },
    });
  }

  /**
   * Unlock next lesson in the pack.
   */
  async unlockNext(userId: string, lessonId: string) {
    const lesson = await prisma.lesson.findUnique({ where: { id: lessonId } });
    if (!lesson) throw new AppError(404, 'Lesson not found', 'LESSON_NOT_FOUND');

    const nextLesson = await prisma.lesson.findFirst({
      where: {
        lessonPackId: lesson.lessonPackId,
        orderIndex: { gt: lesson.orderIndex },
        isPublished: true,
      },
      orderBy: { orderIndex: 'asc' },
    });

    if (!nextLesson) {
      return { message: 'No next lesson available', next_lesson_id: null };
    }

    // Create progress record for next lesson
    await prisma.lessonProgress.upsert({
      where: { userId_lessonId: { userId, lessonId: nextLesson.id } },
      update: {},
      create: { userId, lessonId: nextLesson.id, status: 'NOT_STARTED' },
    });

    return { message: 'Next lesson unlocked', next_lesson_id: nextLesson.id, next_lesson_title: nextLesson.title };
  }
}

export const progressService = new ProgressService();
