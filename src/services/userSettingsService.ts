import { prisma } from '../config';
import { AppError } from '../utils/helpers';
import { UpdateSettingsInput } from '../types/schemas';

export class UserSettingsService {
  async get(userId: string) {
    let settings = await prisma.userSettings.findUnique({ where: { userId } });
    if (!settings) {
      settings = await prisma.userSettings.create({ data: { userId } });
    }
    return {
      default_language: settings.defaultLanguage,
      editor_theme: settings.editorTheme,
      font_size: settings.fontSize,
      auto_save: settings.autoSave,
      preferred_mode: settings.preferredMode,
    };
  }

  async update(userId: string, input: UpdateSettingsInput) {
    const data: any = {};
    if (input.default_language !== undefined) data.defaultLanguage = input.default_language;
    if (input.editor_theme !== undefined) data.editorTheme = input.editor_theme;
    if (input.font_size !== undefined) data.fontSize = input.font_size;
    if (input.auto_save !== undefined) data.autoSave = input.auto_save;
    if (input.preferred_mode !== undefined) data.preferredMode = input.preferred_mode;

    const settings = await prisma.userSettings.upsert({
      where: { userId },
      update: data,
      create: { userId, ...data },
    });

    return {
      default_language: settings.defaultLanguage,
      editor_theme: settings.editorTheme,
      font_size: settings.fontSize,
      auto_save: settings.autoSave,
      preferred_mode: settings.preferredMode,
    };
  }
}

export const userSettingsService = new UserSettingsService();
