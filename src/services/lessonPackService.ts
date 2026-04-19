import { prisma } from '../config';
import { AppError } from '../utils/helpers';

export class LessonPackService {
  async list(filters: { language?: string; difficulty?: string; free_only?: boolean; limit: number; offset: number }) {
    const where: any = { isPublished: true };
    if (filters.language) {
      where.languagePack = { code: filters.language };
    }
    if (filters.difficulty) where.difficulty = filters.difficulty;
    if (filters.free_only) where.isFree = true;

    const [items, total] = await Promise.all([
      prisma.lessonPack.findMany({
        where,
        include: { languagePack: { select: { code: true, name: true } } },
        orderBy: { orderIndex: 'asc' },
        take: filters.limit,
        skip: filters.offset,
      }),
      prisma.lessonPack.count({ where }),
    ]);

    return { items, total };
  }

  async getById(packId: string) {
    const pack = await prisma.lessonPack.findUnique({
      where: { id: packId },
      include: { languagePack: { select: { code: true, name: true } } },
    });
    if (!pack) throw new AppError(404, 'Lesson pack not found', 'PACK_NOT_FOUND');
    return pack;
  }

  async unlock(userId: string, packId: string) {
    await this.getById(packId);
    return prisma.userLessonPack.upsert({
      where: { userId_lessonPackId: { userId, lessonPackId: packId } },
      update: { isUnlocked: true },
      create: { userId, lessonPackId: packId, isUnlocked: true },
    });
  }

  async getUserPacks(userId: string) {
    return prisma.userLessonPack.findMany({
      where: { userId },
      include: { lessonPack: { include: { languagePack: { select: { code: true, name: true } } } } },
    });
  }

  async getManifest(packId: string) {
    const pack = await this.getById(packId);
    return { version: pack.version, manifest: pack.manifest, title: pack.title, total_lessons: pack.totalLessons };
  }

  async getLessons(packId: string) {
    await this.getById(packId);
    return prisma.lesson.findMany({
      where: { lessonPackId: packId, isPublished: true },
      orderBy: { orderIndex: 'asc' },
      select: {
        id: true, title: true, description: true, difficulty: true,
        lessonType: true, estimatedTime: true, orderIndex: true,
      },
    });
  }

  async getLesson(lessonId: string) {
    const lesson = await prisma.lesson.findUnique({
      where: { id: lessonId },
    });
    if (!lesson) throw new AppError(404, 'Lesson not found', 'LESSON_NOT_FOUND');
    return lesson;
  }
}

export const lessonPackService = new LessonPackService();
