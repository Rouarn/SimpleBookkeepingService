import {
  Body,
  Controller,
  HttpCode,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Express } from 'express';
import { CurrentUserId } from '../../../common/decorators/current-user.decorator.js';
import { UploadThrottle } from '../../../common/decorators/upload-throttle.decorator.js';
import {
  THROTTLE_NAMES,
  THROTTLE_RATES,
} from '../../../common/throttler/throttle-rates.js';
import { UploadSceneDto } from '../dto/upload-scene.dto.js';
import { UploadsService } from './uploads.service.js';

@ApiTags('文件')
@Controller('uploads')
export class UploadsController {
  constructor(private readonly uploadsService: UploadsService) {}

  @Post('image')
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
  @ApiOperation({ summary: '上传账单凭证图片（scene 仅支持 bill）' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: { type: 'string', format: 'binary' },
        scene: { type: 'string', enum: ['bill'], default: 'bill' },
      },
    },
  })
  upload(
    @CurrentUserId() userId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: UploadSceneDto,
  ) {
    return this.uploadsService.upload(userId, file, body.scene ?? 'bill');
  }
}
