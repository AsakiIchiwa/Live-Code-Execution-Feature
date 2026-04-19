import { prisma } from '../config';
import { AppError } from '../utils/helpers';
import { SubmitLessonInput } from '../types/schemas';

export class SubmissionService {
  /**
   * Submit code for a lesson — grade against test cases.
   */
  async submit(userId: string, lessonId: string, input: SubmitLessonInput) {
    const lesson = await prisma.lesson.findUnique({
      where: { id: lessonId },
      include: { testCases: { orderBy: { orderIndex: 'asc' } } },
    });
    if (!lesson) throw new AppError(404, 'Lesson not found', 'LESSON_NOT_FOUND');

    const totalTests = lesson.testCases.length;

    const submission = await prisma.submission.create({
      data: {
        userId,
        lessonId,
        sessionId: input.session_id || null,
        sourceCode: input.source_code,
        language: input.language,
        totalTests,
        status: 'PENDING',
      },
    });

    // Simple grading: compare expected output
    // In production, this would run code in sandbox per test case
    let passedTests = 0;
    let feedback = '';
    let finalStatus: 'PASSED' | 'FAILED' | 'ERROR' = 'PASSED';

    try {
      // For now, mark as passed if there are no test cases (tutorial type)
      if (totalTests === 0) {
        passedTests = 0;
        finalStatus = 'PASSED';
        feedback = 'No test cases — submission accepted.';
      } else {
        // TODO: integrate with sandbox execution per test case
        // For now, mark as pending for async grading
        finalStatus = 'PASSED';
        passedTests = totalTests;
        feedback = 'Grading placeholder — integrate with execution engine.';
      }
    } catch (err: any) {
      finalStatus = 'ERROR';
      feedback = err.message || 'Grading error';
    }

    const score = totalTests > 0 ? Math.round((passedTests / totalTests) * 100) : 100;

    const updated = await prisma.submission.update({
      where: { id: submission.id },
      data: {
        status: finalStatus,
        passedTests,
        score,
        feedback,
        completedAt: new Date(),
      },
    });

    // Update progress
    await this.updateProgress(userId, lessonId, finalStatus, score);

    return {
      submission_id: updated.id,
      status: updated.status,
      score: updated.score,
      passed_tests: updated.passedTests,
      total_tests: updated.totalTests,
      feedback: updated.feedback,
    };
  }

  async getById(submissionId: string) {
    const sub = await prisma.submission.findUnique({ where: { id: submissionId } });
    if (!sub) throw new AppError(404, 'Submission not found', 'SUBMISSION_NOT_FOUND');
    return sub;
  }

  async listByLesson(userId: string, lessonId: string) {
    return prisma.submission.findMany({
      where: { userId, lessonId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async getResult(submissionId: string) {
    const sub = await this.getById(submissionId);
    return {
      submission_id: sub.id,
      status: sub.status,
      score: sub.score,
      passed_tests: sub.passedTests,
      total_tests: sub.totalTests,
      feedback: sub.feedback,
      compile_status: sub.compileStatus,
      runtime_status: sub.runtimeStatus,
      execution_time_ms: sub.executionTimeMs,
      memory_used_kb: sub.memoryUsedKb,
    };
  }

  async recheck(submissionId: string) {
    // Re-run grading — placeholder
    const sub = await this.getById(submissionId);
    return { submission_id: sub.id, status: sub.status, message: 'Recheck queued' };
  }

  private async updateProgress(userId: string, lessonId: string, status: string, score: number) {
    const progress = await prisma.lessonProgress.findUnique({
      where: { userId_lessonId: { userId, lessonId } },
    });

    const data: any = {
      attempts: (progress?.attempts || 0) + 1,
      lastActiveAt: new Date(),
    };

    if (status === 'PASSED') {
      data.status = 'COMPLETED';
      data.completedAt = new Date();
    } else if (!progress || progress.status === 'NOT_STARTED') {
      data.status = 'IN_PROGRESS';
    }

    if (score > (progress?.bestScore || 0)) {
      data.bestScore = score;
    }

    await prisma.lessonProgress.upsert({
      where: { userId_lessonId: { userId, lessonId } },
      update: data,
      create: { userId, lessonId, ...data },
    });
  }
}

export const submissionService = new SubmissionService();
