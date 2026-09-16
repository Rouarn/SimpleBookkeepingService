import { Inject, Injectable, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import {
  ThrottlerGuard,
  type ThrottlerLimitDetail,
  type ThrottlerModuleOptions,
  type ThrottlerStorage,
  getOptionsToken,
} from '@nestjs/throttler';
import type { IncomingMessage } from 'node:http';
import { UPLOAD_THROTTLE_KEY } from '../decorators/upload-throttle.decorator.js';
import { BusinessException } from '../exceptions/business.exception.js';
import { ERROR_CODES } from '../exceptions/error-codes.js';
import type { AppConfig } from '../../config/configuration.js';

interface TrackerRequest extends IncomingMessage {
  ip?: string;
}

interface AccessPayload {
  sub?: string;
  type?: string;
}

/**
 * 全局限流守卫（03 §7）。先于 JwtAuthGuard 执行，挡住未登录流量。
 * 1. 计数维度：已登录按用户 ID（不抛错地验签 access token），未登录回退 IP；
 * 2. 上传类路由（/uploads/* 与头像接口）超限返回 42901，其余 42900。
 */
@Injectable()
export class CustomThrottlerGuard extends ThrottlerGuard {
  private readonly accessSecret: string;

  constructor(
    @Inject(getOptionsToken()) options: ThrottlerModuleOptions,
    storageService: ThrottlerStorage,
    reflector: Reflector,
    private readonly jwtService: JwtService,
    configService: ConfigService,
  ) {
    super(options, storageService, reflector);
    this.accessSecret =
      configService.get<AppConfig['jwt']>('jwt')!.accessSecret;
  }

  protected override async getTracker(
    req: Record<string, unknown>,
  ): Promise<string> {
    const request = req as unknown as TrackerRequest;
    const header = request.headers.authorization;
    const token =
      typeof header === 'string' && header.startsWith('Bearer ')
        ? header.slice(7)
        : undefined;

    if (token) {
      try {
        const payload = await this.jwtService.verifyAsync<AccessPayload>(
          token,
          {
            secret: this.accessSecret,
            algorithms: ['HS256'],
          },
        );
        if (payload.type === 'access' && payload.sub) {
          return `user:${payload.sub}`;
        }
      } catch {
        // 非法/过期令牌不阻断限流，回退 IP 维度
      }
    }
    return `ip:${request.ip ?? ''}`;
  }

  protected override async throwThrottlingException(
    context: ExecutionContext,
    _detail: ThrottlerLimitDetail,
  ): Promise<void> {
    const isUploadRoute =
      this.reflector.getAllAndOverride<boolean>(UPLOAD_THROTTLE_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? false;
    const request = context
      .switchToHttp()
      .getRequest<{ originalUrl?: string; url?: string }>();
    const url = request.originalUrl ?? request.url ?? '';

    if (isUploadRoute || url.includes('/uploads/')) {
      throw new BusinessException(
        ERROR_CODES.UPLOAD_RATE_LIMITED.code,
        ERROR_CODES.UPLOAD_RATE_LIMITED.httpStatus,
        ERROR_CODES.UPLOAD_RATE_LIMITED.message,
      );
    }
    throw new BusinessException(
      ERROR_CODES.RATE_LIMITED.code,
      ERROR_CODES.RATE_LIMITED.httpStatus,
      ERROR_CODES.RATE_LIMITED.message,
    );
  }
}
