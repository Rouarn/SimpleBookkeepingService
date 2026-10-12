import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module.js';
import { MessagesModule } from '../messages/messages.module.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './services/auth.service.js';
import { TokenService } from './services/token.service.js';

@Module({
  imports: [FilesModule, MessagesModule],
  controllers: [AuthController],
  providers: [AuthService, TokenService],
  exports: [TokenService],
})
export class AuthModule {}
