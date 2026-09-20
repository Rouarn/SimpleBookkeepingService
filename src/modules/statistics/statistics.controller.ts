import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUserId } from '../../common/decorators/current-user.decorator.js';
import { StatisticsService } from './services/statistics.service.js';
import {
  CategoryStatsQueryDto,
  OverviewQueryDto,
  PayMethodStatsQueryDto,
  TrendQueryDto,
} from './dto/statistics-query.dto.js';

@ApiTags('统计')
@Controller('statistics')
export class StatisticsController {
  constructor(private readonly statisticsService: StatisticsService) {}

  @Get('overview')
  @ApiOperation({
    summary: '概览卡（总额/环比/笔数/日均/结余）；传 year=YYYY 为年维度（附月均），否则按月',
  })
  overview(@CurrentUserId() userId: string, @Query() query: OverviewQueryDto) {
    return this.statisticsService.overview(userId, query);
  }

  @Get('categories')
  @ApiOperation({ summary: '分类排行（month 或 year 二选一）' })
  categories(
    @CurrentUserId() userId: string,
    @Query() query: CategoryStatsQueryDto,
  ) {
    return this.statisticsService.categories(userId, query);
  }

  @Get('pay-methods')
  @ApiOperation({
    summary: '支付方式聚合（固定支出口径，month 或 year 二选一）',
  })
  payMethods(
    @CurrentUserId() userId: string,
    @Query() query: PayMethodStatsQueryDto,
  ) {
    return this.statisticsService.payMethods(userId, query);
  }

  @Get('trend')
  @ApiOperation({
    summary: '收支趋势：months=近 N 个月（默认 6，3~12）；year=YYYY 时返回该年 12 个月',
  })
  trend(@CurrentUserId() userId: string, @Query() query: TrendQueryDto) {
    return this.statisticsService.trend(userId, query);
  }
}
