import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { AppConfig } from '../../config/configuration.js';
import { SignedUrlService } from './services/signed-url.service.js';
import { StorageService } from './services/storage.service.js';
import { ImageValidatorService } from './services/image-validator.service.js';
import { CleanupService } from './services/cleanup.service.js';
import { UploadsService } from './uploads/uploads.service.js';
import { UploadsController } from './uploads/uploads.controller.js';
import { FileSignGuard } from './guards/file-sign.guard.js';
import { FilesController } from './files.controller.js';
import { multerImageFileFilter } from './uploads/multer-image.filter.js';

/**
 * 文件领域（04c §三）：上传、签名访问、每日清理。
 * 按需导出 Storage/SignedUrl/Cleanup 给用户/账单/健康检查模块。
 * Multer 全局内存接收 + 5MB 限制（大小阈值走配置，CoreModule 为 @Global）。
 */
@Module({
  imports: [
    MulterModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        storage: memoryStorage(),
        limits: {
          fileSize:
            configService.get<AppConfig['uploads']>('uploads')!.maxSizeBytes,
          files: 1,
        },
        fileFilter: multerImageFileFilter,
      }),
    }),
  ],
  controllers: [UploadsController, FilesController],
  providers: [
    SignedUrlService,
    ImageValidatorService,
    StorageService,
    CleanupService,
    UploadsService,
    FileSignGuard,
  ],
  exports: [SignedUrlService, StorageService, CleanupService],
})
export class FilesModule {}
