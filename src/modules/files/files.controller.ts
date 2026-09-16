import {
  Controller,
  Get,
  Req,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ApiExcludeController, ApiOperation } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator.js';
import { FileSignGuard } from './guards/file-sign.guard.js';
import { StorageService } from './services/storage.service.js';

const FILES_PREFIX = '/api/v1/files/';

/**
 * 文件读取（04c §11）：@Public 但由 FileSignGuard 校验 HMAC 签名，
 * 通过后流式输出 image/jpeg。uni-app <image> 无法带 Bearer，故用签名 URL。
 */
@Public()
@UseGuards(FileSignGuard)
@ApiExcludeController()
@Controller('files')
export class FilesController {
  constructor(private readonly storageService: StorageService) {}

  @Get('{*key}')
  @ApiOperation({ summary: '签名访问图片文件' })
  serve(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): StreamableFile {
    const url = request.originalUrl ?? request.url ?? '';
    const key = decodeURIComponent(
      (url.split('?')[0] ?? '').slice(FILES_PREFIX.length),
    );
    const absolutePath = this.storageService.resolveExistingFile(key);
    if (!absolutePath) {
      response.status(404);
      return new StreamableFile(Buffer.alloc(0));
    }

    response.setHeader('Content-Type', 'image/jpeg');
    response.setHeader('Cache-Control', 'private, max-age=3600');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    return new StreamableFile(
      this.storageService.createReadStream(absolutePath),
    );
  }
}
