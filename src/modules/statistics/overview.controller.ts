import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUserId } from '../../common/decorators/current-user.decorator.js';
import { OverviewService } from './services/overview.service.js';

@ApiTags('首页概览')
@Controller('overview')
export class OverviewController {
  constructor(private readonly overviewService: OverviewService) {}

  @Get('home')
  @ApiOperation({ summary: '首页一屏聚合' })
  home(@CurrentUserId() userId: string) {
    return this.overviewService.home(userId);
  }
}
