import 'reflect-metadata';
// 全应用统一 Asia/Shanghai（03 §1.1：时间一律东八区）
process.env.TZ = process.env.TZ ?? 'Asia/Shanghai';

import {
  RequestMethod,
  ValidationPipe,
  VersioningType,
  type ValidationError,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import helmet from 'helmet';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module.js';
import type { AppConfig } from './config/configuration.js';
import {
  BusinessException,
  type FieldValidationDetail,
} from './common/exceptions/business.exception.js';
import { ERROR_CODES } from './common/exceptions/error-codes.js';

/** class-validator 错误拍平为字段级 details（03 §4.3），文案来自 DTO 内的中文 message。 */
function flattenValidationErrors(
  errors: ValidationError[],
  parentPath = '',
): FieldValidationDetail[] {
  const details: FieldValidationDetail[] = [];
  for (const error of errors) {
    const fieldPath = parentPath
      ? `${parentPath}.${error.property}`
      : error.property;
    if (error.constraints) {
      const reason = Object.values(error.constraints)[0];
      if (reason) details.push({ field: fieldPath, reason });
    }
    if (error.children && error.children.length > 0) {
      details.push(...flattenValidationErrors(error.children, fieldPath));
    }
  }
  return details;
}

/** 定长比较走 timingSafeEqual（长度不一致时直接拒绝，避免抛异常）。 */
function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Swagger 文档 Basic Auth 中间件（P2-13）：
 * 拦截 /api/docs 及其静态资源，任一请求未带正确凭据即 401 质询；
 * 必须在 SwaggerModule.setup 之前挂载，保证先于文档处理器执行。
 */
function swaggerBasicAuth(user: string, password: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.path?.startsWith('/api/docs')) {
      next();
      return;
    }
    let authenticated = false;
    const match = /^Basic\s+(.+)$/i.exec(req.headers.authorization ?? '');
    if (match) {
      // 用户名禁止含冒号（RFC 7617），按第一个冒号切分
      const decoded = Buffer.from(match[1]!, 'base64').toString('utf8');
      const separator = decoded.indexOf(':');
      if (separator > 0) {
        const providedUser = decoded.slice(0, separator);
        const providedPassword = decoded.slice(separator + 1);
        authenticated =
          constantTimeEquals(providedUser, user) &&
          constantTimeEquals(providedPassword, password);
      }
    }
    if (!authenticated) {
      res.setHeader(
        'WWW-Authenticate',
        'Basic realm="api-docs", charset="UTF-8"',
      );
      res
        .status(401)
        .json({ code: 40100, message: '文档需要认证', data: null });
      return;
    }
    next();
  };
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));

  const configService = app.get(ConfigService);
  const appConfig = configService.get<AppConfig['app']>('app')!;

  // 部署于 nginx 反向代理之后，取真实客户端 IP 用于限流/审计（06 §2）。
  // 跳数由 TRUST_PROXY_HOPS 环境变量控制（默认 1 跳 = 单层 nginx）：
  // 服务端口若可能被直连，必须设 0 并由网关覆盖 X-Forwarded-For，
  // 否则客户端伪造 XFF 可绕过全部基于 IP 的限流与审计。
  app
    .getHttpAdapter()
    .getInstance()
    .set('trust proxy', appConfig.trustProxyHops);

  // 安全响应头（07 §1.2）
  app.use(helmet());

  // CORS 白名单；令牌不依赖 Cookie，credentials 关闭（07 §1.3 / §6）
  app.enableCors({
    origin: appConfig.corsOrigins.length > 0 ? appConfig.corsOrigins : false,
    credentials: false,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Authorization',
      'Content-Type',
      'X-Request-Id',
      'X-Client-Platform',
      'X-Client-Version',
      'Idempotency-Key',
    ],
  });

  // 全局前缀 /api + URI 版本 v1；健康探针不带前缀与版本（03 §1.3，P2-10 拆分 live/ready）
  app.setGlobalPrefix('api', {
    exclude: [
      { path: 'health', method: RequestMethod.GET },
      { path: 'health/live', method: RequestMethod.GET },
      { path: 'health/ready', method: RequestMethod.GET },
    ],
  });
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  // 全局白名单校验（05 §3.1）：校验失败归一化为 40000 + 字段级 details
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
      exceptionFactory: (errors: ValidationError[]) =>
        new BusinessException(
          ERROR_CODES.PARAM_INVALID.code,
          ERROR_CODES.PARAM_INVALID.httpStatus,
          ERROR_CODES.PARAM_INVALID.message,
          flattenValidationErrors(errors),
        ),
    }),
  );

  // Swagger 文档（/api/docs，06 §7 / P2-13）：
  // development 默认挂载；production 默认关闭，仅 ENABLE_SWAGGER=true 时挂载，
  // 且必须配置 SWAGGER_BASIC_USER/PASSWORD（env 启动校验强制密码 >=16 字节），
  // 文档路由前置 HTTP Basic Auth，避免接口结构在公网裸奔。
  const swaggerConfigValue =
    configService.get<AppConfig['swagger']>('swagger')!;
  if (swaggerConfigValue.enabled) {
    if (swaggerConfigValue.basicUser && swaggerConfigValue.basicPassword) {
      app.use(
        swaggerBasicAuth(
          swaggerConfigValue.basicUser,
          swaggerConfigValue.basicPassword,
        ),
      );
    }
    const swaggerConfig = new DocumentBuilder()
      .setTitle('小绿记账 API')
      .setDescription('小绿记账服务端 v1 接口文档')
      .setVersion('1.0')
      .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' })
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document);
  }

  app.enableShutdownHooks();
  await app.listen(appConfig.port, '0.0.0.0');

  const logger = app.get(Logger);
  logger.log(
    `HTTP 服务已启动: http://localhost:${appConfig.port}`,
    'Bootstrap',
  );
  if (swaggerConfigValue.enabled) {
    logger.log(
      `Swagger 文档: http://localhost:${appConfig.port}/api/docs`,
      'Bootstrap',
    );
  }
}

void bootstrap();
