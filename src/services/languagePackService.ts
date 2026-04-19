import { prisma } from '../config';
import { AppError } from '../utils/helpers';

export class LanguagePackService {
  async list() {
    return prisma.languagePack.findMany({
      where: { isPublished: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  async getById(packId: string) {
    const pack = await prisma.languagePack.findUnique({ where: { id: packId } });
    if (!pack) throw new AppError(404, 'Language pack not found', 'PACK_NOT_FOUND');
    return pack;
  }

  async unlock(userId: string, packId: string) {
    const pack = await this.getById(packId);
    return prisma.userLanguagePack.upsert({
      where: { userId_languagePackId: { userId, languagePackId: packId } },
      update: { isUnlocked: true },
      create: { userId, languagePackId: packId, isUnlocked: true },
    });
  }

  async install(userId: string, packId: string) {
    await this.getById(packId);
    return prisma.userLanguagePack.upsert({
      where: { userId_languagePackId: { userId, languagePackId: packId } },
      update: { isInstalled: true, installedAt: new Date() },
      create: { userId, languagePackId: packId, isUnlocked: true, isInstalled: true, installedAt: new Date() },
    });
  }

  async getUserPacks(userId: string) {
    return prisma.userLanguagePack.findMany({
      where: { userId },
      include: { languagePack: true },
    });
  }

  async uninstall(userId: string, packId: string) {
    const record = await prisma.userLanguagePack.findUnique({
      where: { userId_languagePackId: { userId, languagePackId: packId } },
    });
    if (!record) throw new AppError(404, 'Pack not found in user account', 'PACK_NOT_FOUND');
    return prisma.userLanguagePack.update({
      where: { id: record.id },
      data: { isInstalled: false },
    });
  }

  async getManifest(packId: string) {
    const pack = await this.getById(packId);
    return { version: pack.version, manifest: pack.manifest, code: pack.code };
  }
}

export const languagePackService = new LanguagePackService();
