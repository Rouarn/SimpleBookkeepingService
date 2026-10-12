import { Module } from '@nestjs/common';
import { MessagesController } from './messages.controller.js';
import { MessagesService } from './messages.service.js';

/**
 * 消息中心：无任何业务模块依赖（DataSource/Redis 均为全局模块提供），
 * 由账单（超预算）、认证（安全告警）、用户（注销告警）、统计（未读数）、
 * CommonModule（月报/清理 cron）按需引入，导出 MessagesService。
 */
@Module({
  controllers: [MessagesController],
  providers: [MessagesService],
  exports: [MessagesService],
})
export class MessagesModule {}
