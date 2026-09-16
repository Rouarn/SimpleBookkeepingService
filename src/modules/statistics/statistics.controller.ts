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
  @ApiOperation({ summary: '月度概览卡（总额/环比/笔数/日均/结余）' })
  overview(@CurrentUserId() userId: string, @Query() query: OverviewQueryDto) {
    return this.statisticsService.overview(userId, query);
  }

  @Get('categories')
  @ApiOperation({ summary: '月度分类排行' })
  categories(
    @CurrentUserId() userId: string,
    @Query() query: CategoryStatsQueryDto,
  ) {
    return this.statisticsService.categories(userId, query);
  }

  @Get('pay-methods')
  @ApiOperation({ summary: '月度支付方式聚合（固定支出口径）' })
  payMethods(
    @CurrentUserId() userId: string,
    @Query() query: PayMethodStatsQueryDto,
  ) {
    return this.statisticsService.payMethods(userId, query);
  }

  @Get('trend')
  @ApiOperation({ summary: '近 N 个月收支趋势（默认 6，3~12）' })
  trend(@CurrentUserId() userId: string, @Query() query: TrendQueryDto) {
    return this.statisticsService.trend(userId, query);
  }
}
