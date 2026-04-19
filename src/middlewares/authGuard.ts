import { FastifyRequest, FastifyReply } from 'fastify';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { AppError } from '../utils/helpers';

export interface JwtPayload {
  userId: string;
  role: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    currentUser?: JwtPayload;
  }
}

/**
 * Auth middleware — verifies JWT Bearer token and attaches user to request.
 */
export async function authGuard(request: FastifyRequest, _reply: FastifyReply) {
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    throw new AppError(401, 'Missing or invalid Authorization header', 'UNAUTHORIZED');
  }

  const token = authHeader.substring(7);
  try {
    const payload = jwt.verify(token, config.JWT_SECRET) as JwtPayload;
    request.currentUser = payload;
  } catch {
    throw new AppError(401, 'Invalid or expired token', 'UNAUTHORIZED');
  }
}

/**
 * Admin-only middleware — must be used after authGuard.
 */
export async function adminGuard(request: FastifyRequest, _reply: FastifyReply) {
  if (!request.currentUser || request.currentUser.role !== 'ADMIN') {
    throw new AppError(403, 'Admin access required', 'FORBIDDEN');
  }
}

/**
 * Extract current user ID from JWT. Throws if not authenticated.
 */
export function getCurrentUserId(request: FastifyRequest): string {
  if (!request.currentUser) {
    throw new AppError(401, 'Not authenticated', 'UNAUTHORIZED');
  }
  return request.currentUser.userId;
}
