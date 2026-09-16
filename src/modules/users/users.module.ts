import { Module } from '@nestjs/common';
import { BooksModule } from '../books/books.module.js';
import { DictionariesModule } from '../dictionaries/dictionaries.module.js';
import { FilesModule } from '../files/files.module.js';
import { UsersController } from './users.controller.js';
import { UsersService } from './services/users.service.js';

@Module({
  imports: [BooksModule, DictionariesModule, FilesModule],
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
