import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma, config } from '../config';
import { AppError } from '../utils/helpers';
import { RegisterInput, LoginInput, DeviceLoginInput, UpdateProfileInput } from '../types/schemas';
import { randomUUID } from 'crypto';

export class AuthService {
  /**
   * Register a new user with email/password.
   */
  async register(input: RegisterInput) {
    const existing = await prisma.user.findUnique({ where: { email: input.email } });
    if (existing) {
      throw new AppError(409, 'Email already registered', 'EMAIL_EXISTS');
    }

    const passwordHash = await bcrypt.hash(input.password, 12);
    const user = await prisma.user.create({
      data: {
        email: input.email,
        passwordHash,
        displayName: input.display_name || 'Coder',
        settings: { create: {} },
      },
      select: { id: true, email: true, displayName: true, role: true, createdAt: true },
    });

    const tokens = await this.generateTokens(user.id, user.role);
    return { user, ...tokens };
  }

  /**
   * Login with email/password.
   */
  async login(input: LoginInput) {
    const user = await prisma.user.findUnique({ where: { email: input.email } });
    if (!user || !user.passwordHash) {
      throw new AppError(401, 'Invalid email or password', 'INVALID_CREDENTIALS');
    }

    const valid = await bcrypt.compare(input.password, user.passwordHash);
    if (!valid) {
      throw new AppError(401, 'Invalid email or password', 'INVALID_CREDENTIALS');
    }

    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

    const tokens = await this.generateTokens(user.id, user.role);
    return {
      user: { id: user.id, email: user.email, displayName: user.displayName, role: user.role },
      ...tokens,
    };
  }

  /**
   * Device-based anonymous login.
   */
  async deviceLogin(input: DeviceLoginInput) {
    let user = await prisma.user.findUnique({ where: { deviceId: input.device_id } });

    if (!user) {
      user = await prisma.user.create({
        data: {
          deviceId: input.device_id,
          isAnonymous: true,
          displayName: 'Coder',
          settings: { create: {} },
        },
      });
    }

    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

    const tokens = await this.generateTokens(user.id, user.role);
    return {
      user: { id: user.id, displayName: user.displayName, role: user.role, isAnonymous: user.isAnonymous },
      ...tokens,
    };
  }

  /**
   * Refresh access token.
   */
  async refresh(refreshToken: string) {
    const record = await prisma.refreshToken.findUnique({ where: { token: refreshToken } });
    if (!record || record.revokedAt || record.expiresAt < new Date()) {
      throw new AppError(401, 'Invalid or expired refresh token', 'INVALID_REFRESH_TOKEN');
    }

    const user = await prisma.user.findUnique({ where: { id: record.userId } });
    if (!user) {
      throw new AppError(401, 'User not found', 'USER_NOT_FOUND');
    }

    // Rotate refresh token
    await prisma.refreshToken.update({ where: { id: record.id }, data: { revokedAt: new Date() } });

    const tokens = await this.generateTokens(user.id, user.role);
    return { ...tokens };
  }

  /**
   * Logout — revoke refresh token.
   */
  async logout(refreshToken: string) {
    await prisma.refreshToken.updateMany({
      where: { token: refreshToken, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /**
   * Get current user profile.
   */
  async getMe(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true, email: true, displayName: true, avatarUrl: true,
        role: true, isAnonymous: true, createdAt: true, lastLoginAt: true,
      },
    });
    if (!user) throw new AppError(404, 'User not found', 'USER_NOT_FOUND');
    return user;
  }

  /**
   * Update user profile.
   */
  async updateProfile(userId: string, input: UpdateProfileInput) {
    const data: any = {};
    if (input.display_name !== undefined) data.displayName = input.display_name;
    if (input.avatar_url !== undefined) data.avatarUrl = input.avatar_url;

    return prisma.user.update({
      where: { id: userId },
      data,
      select: { id: true, email: true, displayName: true, avatarUrl: true, role: true },
    });
  }

  private async generateTokens(userId: string, role: string) {
    const access_token = jwt.sign({ userId, role }, config.JWT_SECRET, {
      expiresIn: config.JWT_EXPIRES_IN as string | number,
    } as jwt.SignOptions);

    const refreshTokenStr = randomUUID() + '-' + randomUUID();
    const expiresAt = new Date(Date.now() + config.JWT_REFRESH_EXPIRES_IN_DAYS * 86400000);

    await prisma.refreshToken.create({
      data: { userId, token: refreshTokenStr, expiresAt },
    });

    return { access_token, refresh_token: refreshTokenStr };
  }
}

export const authService = new AuthService();
