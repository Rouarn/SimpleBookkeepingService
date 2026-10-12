import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { BooksModule } from '../books/books.module.js';
import { DictionariesModule } from '../dictionaries/dictionaries.module.js';
import { FilesModule } from '../files/files.module.js';
import { MessagesModule } from '../messages/messages.module.js';
import { UsersController } from './users.controller.js';
import { UsersService } from './services/users.service.js';

@Module({
  // AuthModule 提供 TokenService（改密/全员登出复用其 token_version 与吊销能力）
  imports: [AuthModule, BooksModule, DictionariesModule, FilesModule, MessagesModule],
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
