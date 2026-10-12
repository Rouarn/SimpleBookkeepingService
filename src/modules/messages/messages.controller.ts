import {
  Body,
  Controller,
  Get,
  HttpCode,
  Put,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUserId } from '../../common/decorators/current-user.decorator.js';
import { MessagesService } from './messages.service.js';
import {
  MarkReadDto,
  MessageListQueryDto,
} from './dto/message-query.dto.js';

/**
 * 消息中心（鉴权走全局 JwtAuthGuard，无需显式 @UseGuards）。
 */
@ApiTags('消息中心')
@Controller('users/me/messages')
export class MessagesController {
  constructor(private readonly messagesService: MessagesService) {}

  @Get()
  @ApiOperation({ summary: '消息分页列表（倒序）' })
  list(@CurrentUserId() userId: string, @Query() query: MessageListQueryDto) {
    return this.messagesService.list(userId, query.page, query.pageSize);
  }

  @Get('unread-count')
  @ApiOperation({ summary: '未读消息数' })
  unreadCount(@CurrentUserId() userId: string) {
    return this.messagesService.unreadCount(userId).then((count) => ({ count }));
  }

  @Put('read')
  @HttpCode(200)
  @ApiOperation({ summary: '标记已读（ids 与 all 二选一）' })
  markRead(
    @CurrentUserId() userId: string,
    @Body() dto: MarkReadDto,
  ): Promise<{ updated: number }> {
    return this.messagesService.markRead(userId, {
      ids: dto.ids,
      all: dto.all,
    });
  }
}
