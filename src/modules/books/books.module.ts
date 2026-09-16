import { Module } from '@nestjs/common';
import { BooksController } from './books.controller.js';
import { BooksService } from './services/books.service.js';

/** 账本领域（05 §2.4：feature 模块禁止 @Global，按需显式引入）。 */
@Module({
  controllers: [BooksController],
  providers: [BooksService],
  exports: [BooksService],
})
export class BooksModule {}
