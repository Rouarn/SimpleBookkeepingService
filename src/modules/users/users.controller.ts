import {
  Body,
  Controller,
  Get,
  HttpCode,
  Patch,
  Post,
  Put,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Express } from 'express';
import { CurrentUserId } from '../../common/decorators/current-user.decorator.js';
import { UploadThrottle } from '../../common/decorators/upload-throttle.decorator.js';
import {
  THROTTLE_NAMES,
  THROTTLE_RATES,
} from '../../common/throttler/throttle-rates.js';
import { UsersService } from './services/users.service.js';
import { UpdateProfileDto } from './dto/update-profile.dto.js';
import { UpdatePreferencesDto } from './dto/preferences.dto.js';
import { ChangePasswordDto } from './dto/change-password.dto.js';

@ApiTags('用户')
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  @ApiOperation({ summary: '当前用户资料' })
  me(@CurrentUserId() userId: string) {
    return this.usersService.getProfile(userId);
  }

  @Patch('me')
  @ApiOperation({ summary: '修改昵称' })
  updateProfile(
    @CurrentUserId() userId: string,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.usersService.updateName(userId, dto.name);
  }

  @Patch('me/password')
  @ApiOperation({ summary: '修改密码（校验旧密码，成功后吊销全部登录态）' })
  changePassword(
    @CurrentUserId() userId: string,
    @Body() dto: ChangePasswordDto,
  ): Promise<void> {
    return this.usersService.changePassword(userId, dto);
  }

  @Post('me/logout-all')
  @HttpCode(200)
  @ApiOperation({ summary: '全员登出（token_version 自增并吊销全部 refresh）' })
  logoutAll(@CurrentUserId() userId: string): Promise<void> {
    return this.usersService.logoutAll(userId);
  }

  @Post('me/avatar')
  @HttpCode(201)
  @Throttle({
    [THROTTLE_NAMES.UPLOAD]: {
      limit: THROTTLE_RATES[THROTTLE_NAMES.UPLOAD].limit,
      ttl: THROTTLE_RATES[THROTTLE_NAMES.UPLOAD].ttl,
    },
  })
  @UploadThrottle()
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: '更换头像（压缩至 512px 并重编码 JPEG）' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  avatar(
    @CurrentUserId() userId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    return this.usersService.updateAvatar(userId, file);
  }

  @Get('me/stats')
  @ApiOperation({ summary: '我的页记账统计' })
  stats(@CurrentUserId() userId: string) {
    return this.usersService.getStats(userId);
  }

  @Get('me/preferences')
  @ApiOperation({ summary: '获取 UI 偏好' })
  getPreferences(@CurrentUserId() userId: string) {
    return this.usersService.getPreferences(userId);
  }

  @Put('me/preferences')
  @ApiOperation({ summary: '全量同步 UI 偏好' })
  putPreferences(
    @CurrentUserId() userId: string,
    @Body() dto: UpdatePreferencesDto,
  ) {
    return this.usersService.replacePreferences(userId, dto);
  }
}
