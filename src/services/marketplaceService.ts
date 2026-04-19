import { prisma } from '../config';
import { AppError } from '../utils/helpers';

export class MarketplaceService {
  // ─── Creator: Create content ───
  async createLanguagePack(creatorId: string, input: any) {
    const pack = await prisma.languagePack.create({
      data: {
        code: input.code,
        name: input.name,
        description: input.description || '',
        version: input.version || '1.0.0',
        iconUrl: input.icon_url,
        isFree: input.is_free ?? true,
        supportedFeatures: input.supported_features || [],
        manifest: input.manifest || {},
        creatorId,
      },
    });

    // Auto-create marketplace submission
    await prisma.marketplaceSubmission.create({
      data: {
        creatorId,
        itemType: 'LANGUAGE_PACK' as any,
        languagePackId: pack.id,
        status: 'DRAFT' as any,
        title: pack.name,
        description: pack.description,
        version: pack.version,
        price: input.price || 0,
      },
    });

    return pack;
  }

  async createLessonPack(creatorId: string, input: any) {
    const pack = await prisma.lessonPack.create({
      data: {
        languagePackId: input.language_pack_id,
        title: input.title,
        description: input.description || '',
        difficulty: input.difficulty || 'BEGINNER',
        version: input.version || '1.0.0',
        orderIndex: input.order_index || 0,
        isFree: input.is_free ?? true,
        iconUrl: input.icon_url,
        estimatedTime: input.estimated_time || 0,
        creatorId,
      },
    });

    await prisma.marketplaceSubmission.create({
      data: {
        creatorId,
        itemType: 'LESSON_PACK' as any,
        lessonPackId: pack.id,
        status: 'DRAFT' as any,
        title: pack.title,
        description: pack.description,
        version: pack.version,
        price: input.price || 0,
      },
    });

    return pack;
  }

  // ─── Creator: Submit for review ───
  async submitForReview(submissionId: string, creatorId: string) {
    const sub = await prisma.marketplaceSubmission.findUnique({ where: { id: submissionId } });
    if (!sub) throw new AppError(404, 'Submission not found', 'NOT_FOUND');
    if (sub.creatorId !== creatorId) throw new AppError(403, 'Not your submission', 'FORBIDDEN');
    if (sub.status !== 'DRAFT' && sub.status !== 'REJECTED') {
      throw new AppError(400, 'Can only submit DRAFT or REJECTED items', 'BAD_REQUEST');
    }

    return prisma.marketplaceSubmission.update({
      where: { id: submissionId },
      data: { status: 'PENDING_REVIEW' as any, submittedAt: new Date() },
    });
  }

  // ─── Creator: List own submissions ───
  async listMySubmissions(creatorId: string) {
    return prisma.marketplaceSubmission.findMany({
      where: { creatorId },
      orderBy: { createdAt: 'desc' },
      include: { languagePack: true, lessonPack: true },
    });
  }

  // ─── Creator: Update own submission (only DRAFT/REJECTED) ───
  async updateSubmission(submissionId: string, creatorId: string, input: any) {
    const sub = await prisma.marketplaceSubmission.findUnique({ where: { id: submissionId } });
    if (!sub) throw new AppError(404, 'Submission not found', 'NOT_FOUND');
    if (sub.creatorId !== creatorId) throw new AppError(403, 'Not your submission', 'FORBIDDEN');
    if (sub.status !== 'DRAFT' && sub.status !== 'REJECTED') {
      throw new AppError(400, 'Can only edit DRAFT or REJECTED items', 'BAD_REQUEST');
    }

    const data: any = {};
    if (input.title !== undefined) data.title = input.title;
    if (input.description !== undefined) data.description = input.description;
    if (input.version !== undefined) data.version = input.version;
    if (input.price !== undefined) data.price = input.price;

    return prisma.marketplaceSubmission.update({ where: { id: submissionId }, data });
  }

  // ─── Admin: List pending reviews ───
  async listPendingReviews() {
    return prisma.marketplaceSubmission.findMany({
      where: { status: 'PENDING_REVIEW' as any },
      orderBy: { submittedAt: 'asc' },
      include: { creator: { select: { id: true, displayName: true, email: true } }, languagePack: true, lessonPack: true },
    });
  }

  // ─── Admin: Approve ───
  async approve(submissionId: string, adminId: string) {
    const sub = await prisma.marketplaceSubmission.findUnique({ where: { id: submissionId } });
    if (!sub) throw new AppError(404, 'Submission not found', 'NOT_FOUND');
    if (sub.status !== 'PENDING_REVIEW') {
      throw new AppError(400, 'Only PENDING_REVIEW items can be approved', 'BAD_REQUEST');
    }

    // Publish the actual pack
    if (sub.languagePackId) {
      await prisma.languagePack.update({ where: { id: sub.languagePackId }, data: { isPublished: true } });
    }
    if (sub.lessonPackId) {
      const count = await prisma.lesson.count({ where: { lessonPackId: sub.lessonPackId, isPublished: true } });
      await prisma.lessonPack.update({ where: { id: sub.lessonPackId }, data: { isPublished: true, totalLessons: count } });
    }

    return prisma.marketplaceSubmission.update({
      where: { id: submissionId },
      data: {
        status: 'PUBLISHED' as any,
        reviewedBy: adminId,
        reviewedAt: new Date(),
        publishedAt: new Date(),
      },
    });
  }

  // ─── Admin: Reject ───
  async reject(submissionId: string, adminId: string, reviewNote: string) {
    const sub = await prisma.marketplaceSubmission.findUnique({ where: { id: submissionId } });
    if (!sub) throw new AppError(404, 'Submission not found', 'NOT_FOUND');
    if (sub.status !== 'PENDING_REVIEW') {
      throw new AppError(400, 'Only PENDING_REVIEW items can be rejected', 'BAD_REQUEST');
    }

    return prisma.marketplaceSubmission.update({
      where: { id: submissionId },
      data: {
        status: 'REJECTED' as any,
        reviewedBy: adminId,
        reviewedAt: new Date(),
        reviewNote,
      },
    });
  }

  // ─── Admin: Suspend published item ───
  async suspend(submissionId: string, adminId: string, reviewNote: string) {
    const sub = await prisma.marketplaceSubmission.findUnique({ where: { id: submissionId } });
    if (!sub) throw new AppError(404, 'Submission not found', 'NOT_FOUND');

    // Unpublish the pack
    if (sub.languagePackId) {
      await prisma.languagePack.update({ where: { id: sub.languagePackId }, data: { isPublished: false } });
    }
    if (sub.lessonPackId) {
      await prisma.lessonPack.update({ where: { id: sub.lessonPackId }, data: { isPublished: false } });
    }

    return prisma.marketplaceSubmission.update({
      where: { id: submissionId },
      data: {
        status: 'SUSPENDED' as any,
        reviewedBy: adminId,
        reviewedAt: new Date(),
        reviewNote,
      },
    });
  }

  // ─── Public: Browse marketplace ───
  async browse(query: { item_type?: string; free_only?: boolean; limit?: number; offset?: number }) {
    const where: any = { status: 'PUBLISHED' };
    if (query.item_type) where.itemType = query.item_type;
    if (query.free_only) where.price = 0;

    const [items, total] = await Promise.all([
      prisma.marketplaceSubmission.findMany({
        where,
        orderBy: { publishedAt: 'desc' },
        take: query.limit || 20,
        skip: query.offset || 0,
        include: {
          creator: { select: { id: true, displayName: true } },
          languagePack: true,
          lessonPack: true,
        },
      }),
      prisma.marketplaceSubmission.count({ where }),
    ]);

    return { items, total, limit: query.limit || 20, offset: query.offset || 0 };
  }

  // ─── Public: Get single item ───
  async getItem(submissionId: string) {
    const item = await prisma.marketplaceSubmission.findUnique({
      where: { id: submissionId },
      include: {
        creator: { select: { id: true, displayName: true } },
        languagePack: true,
        lessonPack: true,
      },
    });
    if (!item) throw new AppError(404, 'Item not found', 'NOT_FOUND');
    return item;
  }
}

export const marketplaceService = new MarketplaceService();
