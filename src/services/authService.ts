import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { OAuth2Client, TokenPayload } from 'google-auth-library';
import { prisma, config } from '../config';
import { AppError } from '../utils/helpers';
import {
  RegisterInput, LoginInput, DeviceLoginInput, GoogleLoginInput,
  GithubLoginInput, FacebookLoginInput, UpdateProfileInput,
} from '../types/schemas';
import { randomUUID } from 'crypto';

const googleClient = config.GOOGLE_CLIENT_ID ? new OAuth2Client(config.GOOGLE_CLIENT_ID) : null;

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
   * Google Sign-In — verify ID token and find-or-create user.
   */
  async googleLogin(input: GoogleLoginInput) {
    if (!googleClient || !config.GOOGLE_CLIENT_ID) {
      throw new AppError(503, 'Google Sign-In not configured on this server', 'GOOGLE_NOT_CONFIGURED');
    }

    let payload: TokenPayload | undefined;
    try {
      const ticket = await googleClient.verifyIdToken({
        idToken: input.id_token,
        audience: config.GOOGLE_CLIENT_ID,
      });
      payload = ticket.getPayload();
    } catch {
      throw new AppError(401, 'Invalid Google ID token', 'INVALID_GOOGLE_TOKEN');
    }

    if (!payload?.sub) {
      throw new AppError(401, 'Invalid Google ID token payload', 'INVALID_GOOGLE_TOKEN');
    }

    const googleId = payload.sub;
    const email = payload.email ?? null;
    const displayName = payload.name || payload.given_name || 'Google User';
    const avatarUrl = payload.picture ?? null;

    // Find by googleId first, then by email (link existing account).
    let user = await prisma.user.findUnique({ where: { googleId } });
    if (!user && email) {
      user = await prisma.user.findUnique({ where: { email } });
      if (user && !user.googleId) {
        user = await prisma.user.update({ where: { id: user.id }, data: { googleId } });
      }
    }

    if (!user) {
      user = await prisma.user.create({
        data: {
          googleId,
          email,
          displayName,
          avatarUrl,
          isAnonymous: false,
          settings: { create: {} },
        },
      });
    }

    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

    const tokens = await this.generateTokens(user.id, user.role);
    return {
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
        role: user.role,
        isAnonymous: user.isAnonymous,
      },
      ...tokens,
    };
  }

  /**
   * GitHub OAuth — exchange authorization code for access_token, fetch profile, find-or-create user.
   */
  async githubLogin(input: GithubLoginInput) {
    if (!config.GITHUB_CLIENT_ID || !config.GITHUB_CLIENT_SECRET) {
      throw new AppError(503, 'GitHub Sign-In not configured on this server', 'GITHUB_NOT_CONFIGURED');
    }

    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: config.GITHUB_CLIENT_ID,
        client_secret: config.GITHUB_CLIENT_SECRET,
        code: input.code,
        redirect_uri: input.redirect_uri ?? config.GITHUB_REDIRECT_URI,
      }),
    });
    const tokenJson = await tokenRes.json() as { access_token?: string; error?: string; error_description?: string };
    if (!tokenJson.access_token) {
      throw new AppError(401, tokenJson.error_description || 'Failed to exchange GitHub code', 'INVALID_GITHUB_CODE');
    }
    const accessToken = tokenJson.access_token;

    const [userRes, emailsRes] = await Promise.all([
      fetch('https://api.github.com/user', {
        headers: { 'Authorization': `Bearer ${accessToken}`, 'Accept': 'application/vnd.github+json', 'User-Agent': 'edtronaut' },
      }),
      fetch('https://api.github.com/user/emails', {
        headers: { 'Authorization': `Bearer ${accessToken}`, 'Accept': 'application/vnd.github+json', 'User-Agent': 'edtronaut' },
      }),
    ]);
    if (!userRes.ok) {
      throw new AppError(401, 'Failed to fetch GitHub user', 'INVALID_GITHUB_TOKEN');
    }
    const profile = await userRes.json() as { id: number; login: string; name?: string | null; avatar_url?: string | null; email?: string | null };
    const githubId = String(profile.id);
    let email: string | null = profile.email ?? null;
    if (!email && emailsRes.ok) {
      const emails = await emailsRes.json() as Array<{ email: string; primary: boolean; verified: boolean }>;
      email = emails.find(e => e.primary && e.verified)?.email ?? emails.find(e => e.verified)?.email ?? null;
    }
    const displayName = profile.name || profile.login || 'GitHub User';
    const avatarUrl = profile.avatar_url ?? null;

    let user = await prisma.user.findUnique({ where: { githubId } });
    if (!user && email) {
      user = await prisma.user.findUnique({ where: { email } });
      if (user && !user.githubId) {
        user = await prisma.user.update({ where: { id: user.id }, data: { githubId } });
      }
    }
    if (!user) {
      user = await prisma.user.create({
        data: { githubId, email, displayName, avatarUrl, isAnonymous: false, settings: { create: {} } },
      });
    }

    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

    const tokens = await this.generateTokens(user.id, user.role);
    return {
      user: {
        id: user.id, email: user.email, displayName: user.displayName, avatarUrl: user.avatarUrl,
        role: user.role, isAnonymous: user.isAnonymous,
      },
      ...tokens,
    };
  }

  /**
   * Facebook Login — verify access_token via Graph API, find-or-create user.
   */
  async facebookLogin(input: FacebookLoginInput) {
    if (!config.FACEBOOK_APP_ID || !config.FACEBOOK_APP_SECRET) {
      throw new AppError(503, 'Facebook Sign-In not configured on this server', 'FACEBOOK_NOT_CONFIGURED');
    }

    // Verify token belongs to our app via debug_token.
    const appToken = `${config.FACEBOOK_APP_ID}|${config.FACEBOOK_APP_SECRET}`;
    const debugRes = await fetch(`https://graph.facebook.com/debug_token?input_token=${encodeURIComponent(input.access_token)}&access_token=${encodeURIComponent(appToken)}`);
    const debugJson = await debugRes.json() as { data?: { app_id?: string; is_valid?: boolean; user_id?: string } };
    if (!debugJson.data?.is_valid || debugJson.data.app_id !== config.FACEBOOK_APP_ID) {
      throw new AppError(401, 'Invalid Facebook access token', 'INVALID_FACEBOOK_TOKEN');
    }

    const profileRes = await fetch(`https://graph.facebook.com/v18.0/me?fields=id,name,email,picture&access_token=${encodeURIComponent(input.access_token)}`);
    if (!profileRes.ok) {
      throw new AppError(401, 'Failed to fetch Facebook profile', 'INVALID_FACEBOOK_TOKEN');
    }
    const profile = await profileRes.json() as {
      id: string; name?: string; email?: string;
      picture?: { data?: { url?: string } };
    };
    const facebookId = profile.id;
    const email = profile.email ?? null;
    const displayName = profile.name || 'Facebook User';
    const avatarUrl = profile.picture?.data?.url ?? null;

    let user = await prisma.user.findUnique({ where: { facebookId } });
    if (!user && email) {
      user = await prisma.user.findUnique({ where: { email } });
      if (user && !user.facebookId) {
        user = await prisma.user.update({ where: { id: user.id }, data: { facebookId } });
      }
    }
    if (!user) {
      user = await prisma.user.create({
        data: { facebookId, email, displayName, avatarUrl, isAnonymous: false, settings: { create: {} } },
      });
    }

    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

    const tokens = await this.generateTokens(user.id, user.role);
    return {
      user: {
        id: user.id, email: user.email, displayName: user.displayName, avatarUrl: user.avatarUrl,
        role: user.role, isAnonymous: user.isAnonymous,
      },
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
