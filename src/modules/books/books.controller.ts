import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUserId } from '../../common/decorators/current-user.decorator.js';
import { BigIntIdPipe } from '../../common/pipes/bigint-id.pipe.js';
import { BooksService } from './services/books.service.js';
import { CreateBookDto } from './dto/create-book.dto.js';
import { UpdateBookDto } from './dto/update-book.dto.js';
import { SetActiveBookDto } from './dto/set-active-book.dto.js';
import { DeleteBookQueryDto } from './dto/delete-book-query.dto.js';

@ApiTags('账本')
@Controller('books')
export class BooksController {
  constructor(private readonly booksService: BooksService) {}

  @Get()
  @ApiOperation({ summary: '账本列表（含激活态、账单笔数）' })
  list(@CurrentUserId() userId: string) {
    return this.booksService.list(userId);
  }

  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: '新建账本' })
  create(@CurrentUserId() userId: string, @Body() dto: CreateBookDto) {
    return this.booksService.create(userId, dto);
  }

  // 静态路由须在 :id 之前注册
  @Get('active')
  @ApiOperation({ summary: '获取当前激活账本' })
  getActive(@CurrentUserId() userId: string) {
    return this.booksService.getActive(userId);
  }

  @Put('active')
  @ApiOperation({ summary: '切换当前激活账本' })
  setActive(@CurrentUserId() userId: string, @Body() dto: SetActiveBookDto) {
    return this.booksService.setActive(userId, dto.bookId);
  }

  @Get(':id')
  @ApiOperation({ summary: '账本详情' })
  detail(
    @CurrentUserId() userId: string,
    @Param('id', BigIntIdPipe) id: string,
  ) {
    return this.booksService.detail(userId, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: '修改账本名 / 月预算' })
  update(
    @CurrentUserId() userId: string,
    @Param('id', BigIntIdPipe) id: string,
    @Body() dto: UpdateBookDto,
  ) {
    return this.booksService.update(userId, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除账本（可带迁移目标）' })
  remove(
    @CurrentUserId() userId: string,
    @Param('id', BigIntIdPipe) id: string,
    @Query() query: DeleteBookQueryDto,
  ) {
    return this.booksService.remove(userId, id, query.migrateBookId);
  }
}
