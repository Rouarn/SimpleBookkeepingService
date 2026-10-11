import { Controller, Get, Res, VERSION_NEUTRAL } from '@nestjs/common';
import {
  DiskHealthIndicator,
  HealthCheck,
  HealthCheckService,
  TypeOrmHealthIndicator,
} from '@nestjs/terminus';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Response } from 'express';
import { DataSource } from 'typeorm';
import { Public } from '../../common/decorators/public.decorator.js';
import { StorageService } from '../files/services/storage.service.js';
import { RedisHealthIndicator } from './indicators/redis-health.indicator.js';

/** 存活探针静态响应：进程在跑即 200，不查任何外部依赖（P2-10）。 */
const LIVENESS_PAYLOAD = { status: 'ok' } as const;

/**
 * 健康探针（03 §1.3 / 06 §6，P2-10 拆分）：
 * 无 /api 前缀、无版本号（main.ts setGlobalPrefix exclude + VERSION_NEUTRAL）。
 * - GET /health、GET /health/live：liveness，静态 {status:'ok'}，
 *   不查 DB/Redis/disk，供基础设施高频探测（5s/次）；
 * - GET /health/ready：readiness，保留 mysql/redis/disk 三项检查，
 *   磁盘阈值 95%，任一关键指标失败由全局过滤器回 503 {status:'error'}，
 *   内网拓扑等细节仅写服务端日志。
 * 注：探针使用原生 @Res() 直出，绕过业务成功信封（TransformInterceptor），
 * 输出标准 Terminus 形态供基础设施识别；异常仍走全局过滤器收敛。
 */
@Public()
@ApiExcludeController()
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: TypeOrmHealthIndicator,
    private readonly redisIndicator: RedisHealthIndicator,
    private readonly disk: DiskHealthIndicator,
    private readonly dataSource: DataSource,
    private readonly storageService: StorageService,
  ) {}

  /** 兼容旧部署：GET /health 保留为 liveness 别名。 */
  @Get()
  liveAlias(@Res() res: Response): void {
    res.status(200).json(LIVENESS_PAYLOAD);
  }

  /** 存活探针：只要事件循环能响应即成功，不触碰任何依赖。 */
  @Get('live')
  live(@Res() res: Response): void {
    res.status(200).json(LIVENESS_PAYLOAD);
  }

  /** 就绪探针：依赖（MySQL/Redis/磁盘）全部可用才接流量；失败抛出由过滤器收敛。 */
  @Get('ready')
  @HealthCheck()
  async ready(@Res() res: Response): Promise<void> {
    const result = await this.health.check([
      () => this.db.pingCheck('mysql', { connection: this.dataSource }),
      () => this.redisIndicator.isHealthy('redis'),
      () =>
        this.disk.checkStorage('disk', {
          path: this.storageService.getRootDir(),
          thresholdPercent: 0.95,
        }),
    ]);
    res.status(200).json(result);
  }
}
