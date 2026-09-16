import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { FilesModule } from '../files/files.module.js';
import { HealthController } from './health.controller.js';
import { RedisHealthIndicator } from './indicators/redis-health.indicator.js';

@Module({
  imports: [TerminusModule, FilesModule],
  controllers: [HealthController],
  providers: [RedisHealthIndicator],
})
export class HealthModule {}
