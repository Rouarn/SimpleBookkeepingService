import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUserId } from '../../common/decorators/current-user.decorator.js';
import { BigIntIdPipe } from '../../common/pipes/bigint-id.pipe.js';
import {
  THROTTLE_NAMES,
  THROTTLE_RATES,
} from '../../common/throttler/throttle-rates.js';
import { BillsService } from './services/bills.service.js';
import {
  BillListQueryDto,
  BookScopeQueryDto,
  ClearBillsDto,
  CreateBillDto,
  GroupedQueryDto,
  SummaryQueryDto,
  UpdateBillDto,
} from './dto/bill-list-query.dto.js';

const WRITE_THROTTLE = {
  [THROTTLE_NAMES.BILL_WRITE]: {
    limit: THROTTLE_RATES[THROTTLE_NAMES.BILL_WRITE].limit,
    ttl: THROTTLE_RATES[THROTTLE_NAMES.BILL_WRITE].ttl,
  },
} as const;

const DELETE_THROTTLE = {
  [THROTTLE_NAMES.BILL_DELETE]: {
    limit: THROTTLE_RATES[THROTTLE_NAMES.BILL_DELETE].limit,
    ttl: THROTTLE_RATES[THROTTLE_NAMES.BILL_DELETE].ttl,
  },
} as const;

@ApiTags('账单')
@Controller('bills')
export class BillsController {
  constructor(private readonly billsService: BillsService) {}

  @Get()
  @ApiOperation({ summary: '账单分页列表（按月/类型/账本筛选）' })
  list(@CurrentUserId() userId: string, @Query() query: BillListQueryDto) {
    return this.billsService.list(userId, query);
  }

  // 静态路由须先于 :id 注册
  @Get('today')
  @ApiOperation({ summary: '今日流水（首页用）' })
  today(@CurrentUserId() userId: string, @Query() query: BookScopeQueryDto) {
    return this.billsService.today(userId, query);
  }

  @Get('grouped')
  @ApiOperation({ summary: '指定月份按天分组流水' })
  grouped(@CurrentUserId() userId: string, @Query() query: GroupedQueryDto) {
    return this.billsService.grouped(userId, query);
  }

  @Get('summary')
  @ApiOperation({ summary: '月度收支汇总' })
  summary(@CurrentUserId() userId: string, @Query() query: SummaryQueryDto) {
    return this.billsService.summary(userId, query);
  }

  @Post()
  @HttpCode(201)
  @Throttle(WRITE_THROTTLE)
  @ApiOperation({ summary: '新增账单（支持 Idempotency-Key）' })
  create(
    @CurrentUserId() userId: string,
    @Body() dto: CreateBillDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.billsService.create(
      userId,
      dto,
      this.normalizeHeader(idempotencyKey),
    );
  }

  @Delete()
  @HttpCode(200)
  @Throttle(DELETE_THROTTLE)
  @ApiOperation({ summary: '清空账单（可限定账本，需 confirm）' })
  clear(@CurrentUserId() userId: string, @Body() dto: ClearBillsDto) {
    return this.billsService.clear(userId, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: '账单详情' })
  detail(
    @CurrentUserId() userId: string,
    @Param('id', BigIntIdPipe) id: string,
  ) {
    return this.billsService.detail(userId, id);
  }

  @Patch(':id')
  @Throttle(WRITE_THROTTLE)
  @ApiOperation({ summary: '编辑账单（局部更新，photos 全量替换）' })
  update(
    @CurrentUserId() userId: string,
    @Param('id', BigIntIdPipe) id: string,
    @Body() dto: UpdateBillDto,
  ) {
    return this.billsService.update(userId, id, dto);
  }

  @Delete(':id')
  @HttpCode(200)
  @Throttle(DELETE_THROTTLE)
  @ApiOperation({ summary: '删除单条账单' })
  remove(
    @CurrentUserId() userId: string,
    @Param('id', BigIntIdPipe) id: string,
  ) {
    return this.billsService.remove(userId, id);
  }

  private normalizeHeader(
    value: string | string[] | undefined,
  ): string | undefined {
    const header = Array.isArray(value) ? value[0] : value;
    if (!header) return undefined;
    const trimmed = header.trim();
    // Idempotency-Key 限长 64，字符集限字母数字与常见分隔符
    if (
      trimmed.length === 0 ||
      trimmed.length > 64 ||
      !/^[A-Za-z0-9:._-]+$/.test(trimmed)
    ) {
      return undefined;
    }
    return trimmed;
  }
}
