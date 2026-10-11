import { Injectable } from '@nestjs/common';
import type { Express } from 'express';
import { BusinessException } from '../../../common/exceptions/business.exception.js';
import { ERROR_CODES } from '../../../common/exceptions/error-codes.js';
import { SignedUrlService } from '../services/signed-url.service.js';
import { StorageService } from '../services/storage.service.js';

export interface UploadResultVo {
  key: string;
  url: string;
  expiresAt: string;
  width: number;
  height: number;
  size: number;
}

/**
 * 图片上传（04c §10）：内存接收 → 三重校验 → sharp 重编码 → 落盘 → 返回 key 与签名 URL。
 * HTTP 入口仅服务账单凭证（scene=bill）；头像不走本服务，
 * 由 POST /users/me/avatar 的 UsersService 内部直接复用 StorageService（P2-08）。
 */
@Injectable()
export class UploadsService {
  constructor(
    private readonly storageService: StorageService,
    private readonly signedUrlService: SignedUrlService,
  ) {}

  async upload(
    userId: string,
    file: Express.Multer.File | undefined,
    scene: string = 'bill',
  ): Promise<UploadResultVo> {
    // scene 白名单：avatar 等非 bill 值一律拒绝，防止匿名写头像目录且不落库
    if (scene !== 'bill') {
      throw new BusinessException(
        ERROR_CODES.UPLOAD_SCENE_INVALID.code,
        ERROR_CODES.UPLOAD_SCENE_INVALID.httpStatus,
        ERROR_CODES.UPLOAD_SCENE_INVALID.message,
      );
    }
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
