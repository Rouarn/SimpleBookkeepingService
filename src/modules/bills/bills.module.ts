import { Module } from '@nestjs/common';
import { BooksModule } from '../books/books.module.js';
import { DictionariesModule } from '../dictionaries/dictionaries.module.js';
import { FilesModule } from '../files/files.module.js';
import { BillsController } from './bills.controller.js';
import { BillsService } from './services/bills.service.js';
import { IdempotencyService } from './services/idempotency.service.js';

@Module({
  imports: [BooksModule, DictionariesModule, FilesModule],
  controllers: [BillsController],
  providers: [BillsService, IdempotencyService],
  exports: [BillsService],
})
export class BillsModule {}
