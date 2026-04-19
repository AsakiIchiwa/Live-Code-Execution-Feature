import { prisma } from '../config';
import { AppError } from '../utils/helpers';
import {
  CreateLanguagePackInput, UpdateLanguagePackInput,
  CreateLessonPackInput, UpdateLessonPackInput,
  CreateLessonInput, UpdateLessonInput,
  CreateTestCaseInput, UpdateTestCaseInput,
} from '../types/schemas';

export class AdminService {
  // ─── Language Packs ───
  async createLanguagePack(input: CreateLanguagePackInput) {
    return prisma.languagePack.create({
      data: {
        code: input.code,
        name: input.name,
        description: input.description,
        version: input.version,
        iconUrl: input.icon_url,
        isBuiltin: input.is_builtin,
        isFree: input.is_free,
        supportedFeatures: input.supported_features,
        manifest: input.manifest as any,
      },
    });
  }

  async updateLanguagePack(packId: string, input: UpdateLanguagePackInput) {
    const data: any = {};
    if (input.code !== undefined) data.code = input.code;
    if (input.name !== undefined) data.name = input.name;
    if (input.description !== undefined) data.description = input.description;
    if (input.version !== undefined) data.version = input.version;
    if (input.icon_url !== undefined) data.iconUrl = input.icon_url;
    if (input.is_builtin !== undefined) data.isBuiltin = input.is_builtin;
    if (input.is_free !== undefined) data.isFree = input.is_free;
    if (input.supported_features !== undefined) data.supportedFeatures = input.supported_features;
    if (input.manifest !== undefined) data.manifest = input.manifest;

    return prisma.languagePack.update({ where: { id: packId }, data });
  }

  async publishLanguagePack(packId: string) {
    return prisma.languagePack.update({ where: { id: packId }, data: { isPublished: true } });
  }

  // ─── Lesson Packs ───
  async createLessonPack(input: CreateLessonPackInput) {
    return prisma.lessonPack.create({
      data: {
        languagePackId: input.language_pack_id,
        title: input.title,
        description: input.description,
        difficulty: input.difficulty as any,
        version: input.version,
        orderIndex: input.order_index,
        isFree: input.is_free,
        iconUrl: input.icon_url,
        estimatedTime: input.estimated_time,
      },
    });
  }

  async updateLessonPack(packId: string, input: UpdateLessonPackInput) {
    const data: any = {};
    if (input.title !== undefined) data.title = input.title;
    if (input.description !== undefined) data.description = input.description;
    if (input.difficulty !== undefined) data.difficulty = input.difficulty;
    if (input.version !== undefined) data.version = input.version;
    if (input.order_index !== undefined) data.orderIndex = input.order_index;
    if (input.is_free !== undefined) data.isFree = input.is_free;
    if (input.icon_url !== undefined) data.iconUrl = input.icon_url;
    if (input.estimated_time !== undefined) data.estimatedTime = input.estimated_time;

    return prisma.lessonPack.update({ where: { id: packId }, data });
  }

  async publishLessonPack(packId: string) {
    // Also update total_lessons count
    const count = await prisma.lesson.count({ where: { lessonPackId: packId, isPublished: true } });
    return prisma.lessonPack.update({
      where: { id: packId },
      data: { isPublished: true, totalLessons: count },
    });
  }

  // ─── Lessons ───
  async createLesson(input: CreateLessonInput) {
    return prisma.lesson.create({
      data: {
        lessonPackId: input.lesson_pack_id,
        title: input.title,
        description: input.description,
        instructions: input.instructions,
        starterCode: input.starter_code,
        expectedOutput: input.expected_output,
        difficulty: input.difficulty as any,
        lessonType: input.lesson_type as any,
        estimatedTime: input.estimated_time,
        orderIndex: input.order_index,
      },
    });
  }

  async updateLesson(lessonId: string, input: UpdateLessonInput) {
    const data: any = {};
    if (input.title !== undefined) data.title = input.title;
    if (input.description !== undefined) data.description = input.description;
    if (input.instructions !== undefined) data.instructions = input.instructions;
    if (input.starter_code !== undefined) data.starterCode = input.starter_code;
    if (input.expected_output !== undefined) data.expectedOutput = input.expected_output;
    if (input.difficulty !== undefined) data.difficulty = input.difficulty;
    if (input.lesson_type !== undefined) data.lessonType = input.lesson_type;
    if (input.estimated_time !== undefined) data.estimatedTime = input.estimated_time;
    if (input.order_index !== undefined) data.orderIndex = input.order_index;

    return prisma.lesson.update({ where: { id: lessonId }, data });
  }

  // ─── Test Cases ───
  async createTestCase(lessonId: string, input: CreateTestCaseInput) {
    return prisma.testCase.create({
      data: {
        lessonId,
        input: input.input,
        expected: input.expected,
        isPublic: input.is_public,
        isHidden: input.is_hidden,
        orderIndex: input.order_index,
        description: input.description,
      },
    });
  }

  async updateTestCase(testCaseId: string, input: UpdateTestCaseInput) {
    const data: any = {};
    if (input.input !== undefined) data.input = input.input;
    if (input.expected !== undefined) data.expected = input.expected;
    if (input.is_public !== undefined) data.isPublic = input.is_public;
    if (input.is_hidden !== undefined) data.isHidden = input.is_hidden;
    if (input.order_index !== undefined) data.orderIndex = input.order_index;
    if (input.description !== undefined) data.description = input.description;

    return prisma.testCase.update({ where: { id: testCaseId }, data });
  }
}

export const adminService = new AdminService();
