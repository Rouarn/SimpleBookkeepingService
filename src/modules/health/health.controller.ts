import { Controller, Get, VERSION_NEUTRAL } from '@nestjs/common';
import {
  DiskHealthIndicator,
  HealthCheck,
  HealthCheckService,
  TypeOrmHealthIndicator,
} from '@nestjs/terminus';
import { ApiExcludeController } from '@nestjs/swagger';
import { DataSource } from 'typeorm';
import { Public } from '../../common/decorators/public.decorator.js';
import { StorageService } from '../files/services/storage.service.js';
import { RedisHealthIndicator } from './indicators/redis-health.indicator.js';

/**
 * 存活探针（03 §1.3 / 06 §6）：
 * 无 /api 前缀、无版本号（main.ts setGlobalPrefix exclude + VERSION_NEUTRAL）。
 * Terminus 任一关键指标失败返回 503；磁盘阈值 95%。
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

  @Get()
  @HealthCheck()
  check() {
    return this.health.check([
      () => this.db.pingCheck('mysql', { connection: this.dataSource }),
      () => this.redisIndicator.isHealthy('redis'),
      () =>
        this.disk.checkStorage('disk', {
          path: this.storageService.getRootDir(),
          thresholdPercent: 0.95,
        }),
    ]);
  }
}
