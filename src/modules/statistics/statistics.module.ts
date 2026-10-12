import { Module } from '@nestjs/common';
import { BooksModule } from '../books/books.module.js';
import { BillsModule } from '../bills/bills.module.js';
import { MessagesModule } from '../messages/messages.module.js';
import { StatisticsController } from './statistics.controller.js';
import { OverviewController } from './overview.controller.js';
import { StatisticsService } from './services/statistics.service.js';
import { OverviewService } from './services/overview.service.js';

@Module({
  imports: [BooksModule, BillsModule, MessagesModule],
  controllers: [StatisticsController, OverviewController],
  providers: [StatisticsService, OverviewService],
})
export class StatisticsModule {}
