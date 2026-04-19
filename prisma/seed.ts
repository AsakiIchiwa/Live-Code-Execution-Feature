import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  // ─── Supported Languages (runtime) ───
  const languages = [
    { name: 'python', version: '3.12', dockerImage: 'sandbox-python:3.12', fileExtension: '.py', maxTimeoutMs: 10000, maxMemoryKb: 262144 },
    { name: 'javascript', version: 'node20', dockerImage: 'sandbox-node:20', fileExtension: '.js', maxTimeoutMs: 10000, maxMemoryKb: 262144 },
    { name: 'java', version: '21', dockerImage: 'sandbox-java:21', fileExtension: '.java', maxTimeoutMs: 15000, maxMemoryKb: 524288 },
    { name: 'cpp', version: '14', dockerImage: 'sandbox-cpp:14', fileExtension: '.cpp', maxTimeoutMs: 10000, maxMemoryKb: 262144 },
  ];

  for (const lang of languages) {
    await prisma.supportedLanguage.upsert({
      where: { name: lang.name },
      update: lang,
      create: lang,
    });
  }
  console.log('Seeded', languages.length, 'supported languages');

  // ─── Language Packs ───
  const javaPack = await prisma.languagePack.upsert({
    where: { code: 'java' },
    update: {},
    create: {
      code: 'java',
      name: 'Java',
      description: 'Java programming language — built-in, no download needed.',
      version: '1.0.0',
      isBuiltin: true,
      isFree: true,
      isPublished: true,
      supportedFeatures: ['code_execution', 'syntax_highlight', 'autocomplete'],
    },
  });

  const pythonPack = await prisma.languagePack.upsert({
    where: { code: 'python' },
    update: {},
    create: {
      code: 'python',
      name: 'Python',
      description: 'Python 3.12 language pack.',
      version: '1.0.0',
      isBuiltin: false,
      isFree: true,
      isPublished: true,
      supportedFeatures: ['code_execution', 'syntax_highlight'],
    },
  });

  console.log('Seeded language packs');

  // ─── Lesson Packs ───
  const javaBasicsPack = await prisma.lessonPack.upsert({
    where: { id: '00000000-0000-0000-0000-000000000001' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000001',
      languagePackId: javaPack.id,
      title: 'Java Basics',
      description: 'Learn the fundamentals of Java programming.',
      difficulty: 'BEGINNER',
      isFree: true,
      isPublished: true,
      orderIndex: 1,
      estimatedTime: 120,
    },
  });
  console.log('Seeded lesson packs');

  // ─── Lessons ───
  const lessons = [
    {
      id: '00000000-0000-0000-0001-000000000001',
      lessonPackId: javaBasicsPack.id,
      title: 'Hello World',
      description: 'Write your first Java program.',
      instructions: 'Create a program that prints "Hello, World!" to the console.',
      starterCode: 'public class Main {\n    public static void main(String[] args) {\n        // Write your code here\n    }\n}',
      expectedOutput: 'Hello, World!',
      difficulty: 'BEGINNER' as const,
      lessonType: 'EXERCISE' as const,
      estimatedTime: 5,
      orderIndex: 1,
      isPublished: true,
    },
    {
      id: '00000000-0000-0000-0001-000000000002',
      lessonPackId: javaBasicsPack.id,
      title: 'Variables and Types',
      description: 'Learn about Java variables and data types.',
      instructions: 'Declare variables of different types and print them.',
      starterCode: 'public class Main {\n    public static void main(String[] args) {\n        // Declare an int, a double, and a String\n    }\n}',
      difficulty: 'BEGINNER' as const,
      lessonType: 'TUTORIAL' as const,
      estimatedTime: 10,
      orderIndex: 2,
      isPublished: true,
    },
  ];

  for (const lesson of lessons) {
    await prisma.lesson.upsert({
      where: { id: lesson.id },
      update: {},
      create: lesson,
    });
  }
  console.log('Seeded', lessons.length, 'lessons');

  // ─── Test Cases ───
  await prisma.testCase.upsert({
    where: { id: '00000000-0000-0000-0002-000000000001' },
    update: {},
    create: {
      id: '00000000-0000-0000-0002-000000000001',
      lessonId: '00000000-0000-0000-0001-000000000001',
      input: '',
      expected: 'Hello, World!\n',
      isPublic: true,
      orderIndex: 1,
      description: 'Should print Hello, World!',
    },
  });
  console.log('Seeded test cases');

  // Update lesson pack total
  await prisma.lessonPack.update({
    where: { id: javaBasicsPack.id },
    data: { totalLessons: lessons.length },
  });

  // ─── Admin User ───
  const adminPassword = await bcrypt.hash('admin123', 12);
  await prisma.user.upsert({
    where: { email: 'admin@edtronaut.ai' },
    update: {},
    create: {
      email: 'admin@edtronaut.ai',
      passwordHash: adminPassword,
      displayName: 'Admin',
      role: 'ADMIN',
      settings: { create: {} },
    },
  });
  console.log('Seeded admin user (admin@edtronaut.ai / admin123)');

  console.log('Seeding complete!');
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
