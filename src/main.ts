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

  // 全局前缀 /api + URI 版本 v1；/health 不带前缀与版本（03 §1.3）
  app.setGlobalPrefix('api', {
    exclude: [{ path: 'health', method: RequestMethod.GET }],
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

  // Swagger 仅非生产暴露（/api/docs，06 §7）
  if (!appConfig.isProduction) {
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
  if (!appConfig.isProduction) {
    logger.log(
      `Swagger 文档: http://localhost:${appConfig.port}/api/docs`,
      'Bootstrap',
    );
  }
}

void bootstrap();
