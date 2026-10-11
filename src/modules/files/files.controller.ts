import {
  Controller,
  Get,
  Req,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiExcludeController, ApiOperation } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator.js';
import { FileSignGuard, type FileSignRequest } from './guards/file-sign.guard.js';
import { StorageService } from './services/storage.service.js';

/**
 * 文件读取（04c §11）：@Public 但由 FileSignGuard 校验 HMAC 签名，
 * 通过后流式输出 image/jpeg。uni-app <image> 无法带 Bearer，故用签名 URL。
 * 守卫已完成路径解析与存在性检查并把绝对路径挂到 request，这里直接复用，
 * 不再重复解析 key 或做第二次同步磁盘检查。
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
    @Req() request: FileSignRequest,
    @Res({ passthrough: true }) response: Response,
  ): StreamableFile {
    // 守卫已保证文件存在；此处兜底仅防极端竞态（放行后文件被删），无磁盘 IO
    const absolutePath = request.fileAbsolutePath;
    if (!absolutePath) {
      response.status(404);
      return new StreamableFile(Buffer.alloc(0));
    }

    response.setHeader('Content-Type', 'image/jpeg');
    response.setHeader('Cache-Control', 'private, max-age=3600');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    // 图片需被跨源页面嵌入（App webview / H5 开发页与服务端不同源）：
    // helmet 默认 CORP=same-origin 会导致 <image>/<img> 被拦截而原生
    // previewImage 却可显示。文件本身受 HMAC 签名+过期时间保护，允许跨源嵌入安全。
    response.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    return new StreamableFile(
      this.storageService.createReadStream(absolutePath),
    );
  }
}
