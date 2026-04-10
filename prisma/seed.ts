import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding supported languages...');

  const languages = [
    {
      name: 'python',
      version: '3.12',
      dockerImage: 'sandbox-python:3.12',
      fileExtension: '.py',
      maxTimeoutMs: 10000,
      maxMemoryKb: 262144,
    },
    {
      name: 'javascript',
      version: 'node20',
      dockerImage: 'sandbox-node:20',
      fileExtension: '.js',
      maxTimeoutMs: 10000,
      maxMemoryKb: 262144,
    },
    {
      name: 'java',
      version: '21',
      dockerImage: 'sandbox-java:21',
      fileExtension: '.java',
      maxTimeoutMs: 15000,
      maxMemoryKb: 524288,
    },
    {
      name: 'cpp',
      version: '14',
      dockerImage: 'sandbox-cpp:14',
      fileExtension: '.cpp',
      maxTimeoutMs: 10000,
      maxMemoryKb: 262144,
    },
  ];

  for (const lang of languages) {
    await prisma.supportedLanguage.upsert({
      where: { name: lang.name },
      update: lang,
      create: lang,
    });
  }

  console.log('Seeded', languages.length, 'languages');
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
