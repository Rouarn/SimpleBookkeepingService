import { Injectable } from '@nestjs/common';
import type { Express } from 'express';
import { BusinessException } from '../../../common/exceptions/business.exception.js';
import { ERROR_CODES } from '../../../common/exceptions/error-codes.js';
import { SignedUrlService } from '../services/signed-url.service.js';
import {
  StorageService,
  type UploadScene,
} from '../services/storage.service.js';

export interface UploadResultVo {
  key: string;
  url: string;
  expiresAt: string;
  width: number;
  height: number;
  size: number;
}

/** 图片上传（04c §10）：内存接收 → 三重校验 → sharp 重编码 → 落盘 → 返回 key 与签名 URL。 */
@Injectable()
export class UploadsService {
  constructor(
    private readonly storageService: StorageService,
    private readonly signedUrlService: SignedUrlService,
  ) {}

  async upload(
    userId: string,
    file: Express.Multer.File | undefined,
    scene: UploadScene = 'bill',
  ): Promise<UploadResultVo> {
    if (!file || !file.buffer) {
      throw new BusinessException(
        ERROR_CODES.PARAM_INVALID.code,
        ERROR_CODES.PARAM_INVALID.httpStatus,
        '文件为空',
      );
    }

    const saved = await this.storageService.saveImage(
      userId,
      scene,
      file.originalname,
      file.mimetype,
      file.buffer,
    );
    const signed = this.signedUrlService.sign(saved.key);

    return {
      key: saved.key,
      url: signed.url,
      expiresAt: signed.expiresAt,
      width: saved.width,
      height: saved.height,
      size: saved.size,
    };
  }
}
