import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CategoryQueryDto } from './dto/category-query.dto.js';
import { CategoriesService } from './services/categories.service.js';
import { PayMethodsService } from './services/pay-methods.service.js';

@ApiTags('字典')
@Controller()
export class DictionariesController {
  constructor(
    private readonly categoriesService: CategoriesService,
    private readonly payMethodsService: PayMethodsService,
  ) {}

  @Get('categories')
  @ApiOperation({ summary: '收支分类字典（可按 type 过滤）' })
  categories(@Query() query: CategoryQueryDto) {
    return this.categoriesService.list(query.type);
  }

  @Get('pay-methods')
  @ApiOperation({ summary: '支付方式字典（仅启用项）' })
  payMethods() {
    return this.payMethodsService.list();
  }
}
