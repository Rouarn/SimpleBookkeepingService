import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import sharp from 'sharp';
import type { Metadata } from 'sharp';
import {
  chmod,
  constants as fsConstants,
  mkdir,
  access,
  writeFile,
} from 'node:fs/promises';
import { createReadStream, existsSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { AppConfig } from '../../../config/configuration.js';
import { BusinessException } from '../../../common/exceptions/business.exception.js';
import { ERROR_CODES } from '../../../common/exceptions/error-codes.js';
import { ImageValidatorService } from './image-validator.service.js';

export type UploadScene = 'bill' | 'avatar';

export interface SavedImage {
  key: string;
  buffer: Buffer;
  width: number;
  height: number;
  size: number;
}

const KEY_PATTERN =
  /^(bills|avatars)\/\d{1,19}(\/\d{4}\/\d{2}\/\d{2})?\/[A-Za-z0-9._-]+\.jpg$/;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function storageUnavailable(message: string): never {
  throw new BusinessException(
    ERROR_CODES.STORAGE_UNAVAILABLE.code,
    ERROR_CODES.STORAGE_UNAVAILABLE.httpStatus,
    message,
  );
}

/**
 * 本地磁盘存储（04c §三）：
 * Multer 内存缓冲 → 三重校验 → sharp 重编码（去 EXIF、PNG 白底转 JPEG）
 * → 按规则生成 key → 0700 目录 / 0600 文件写盘。
 */
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger('StorageService');
  private readonly rootDir: string;
  private readonly billMaxEdge: number;
  private readonly avatarMaxEdge: number;
  private readonly validationMaxEdge: number;

  constructor(
    private readonly configService: ConfigService,
    private readonly imageValidator: ImageValidatorService,
  ) {
    const uploadsConfig =
      this.configService.get<AppConfig['uploads']>('uploads')!;
    this.rootDir = resolve(uploadsConfig.dir);
    this.billMaxEdge = uploadsConfig.billMaxEdge;
    this.avatarMaxEdge = uploadsConfig.avatarMaxEdge;
    this.validationMaxEdge = 4096;
  }

  /** 启动即校验 UPLOAD_DIR 存在且可写，否则 fail-fast（04c §10）。 */
  async onModuleInit(): Promise<void> {
    try {
      await mkdir(this.rootDir, { recursive: true, mode: 0o700 });
      await chmod(this.rootDir, 0o700);
      await access(this.rootDir, fsConstants.R_OK | fsConstants.W_OK);
    } catch (error) {
      this.logger.error(
        `上传目录不可用: ${this.rootDir} - ${(error as Error).message}`,
      );
      storageUnavailable(ERROR_CODES.STORAGE_UNAVAILABLE.message);
    }
  }

  /** 校验并重编码上传图片，写入磁盘，返回 key 与产物信息。 */
  async saveImage(
    userId: string,
    scene: UploadScene,
    originalName: string,
    declaredMime: string,
    input: Buffer,
  ): Promise<SavedImage> {
    const targetEdge =
      scene === 'avatar' ? this.avatarMaxEdge : this.billMaxEdge;
    const quality = scene === 'avatar' ? 0.85 : 0.82;

    this.imageValidator.validate(input, declaredMime, originalName);

    let output: Buffer;
    let metadata: Metadata;
    try {
      const image = sharp(input, { failOn: 'error' }).rotate(); // 按 EXIF 旋正后随重编码清除
      metadata = await image.metadata();
      this.imageValidator.assertEdgeAllowed(
        Number(metadata.width),
        Number(metadata.height),
        this.validationMaxEdge,
      );
      output = await image
        .resize({
          width: targetEdge,
          height: targetEdge,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .flatten({ background: '#ffffff' }) // PNG 透明图填白底
        .jpeg({ quality: Math.round(quality * 100), mozjpeg: true })
        .toBuffer();
    } catch (error) {
      if (error instanceof BusinessException) throw error;
      throw new BusinessException(
        ERROR_CODES.PARAM_INVALID.code,
        ERROR_CODES.PARAM_INVALID.httpStatus,
        '图片无法解析或已损坏',
      );
    }

    const finalMeta = await sharp(output).metadata();
    const key = this.buildKey(userId, scene);
    await this.writeKey(key, output);

    return {
      key,
      buffer: output,
      width: Number(finalMeta.width),
      height: Number(finalMeta.height),
      size: output.length,
    };
  }

  /**
   * key 归一化与目录穿越防护：白名单正则 + resolve 后必须仍在 ROOT 内。
   * 返回绝对路径；文件不存在返回 null（由调用方决定 404）。
   */
  resolveExistingFile(key: string): string | null {
    if (!KEY_PATTERN.test(key)) return null;
    const decoded = this.safeDecode(key);
    if (!decoded) return null;

    const absolute = resolve(this.rootDir, decoded);
    if (absolute !== this.rootDir && !absolute.startsWith(this.rootDir + sep)) {
      return null;
    }
    return existsSync(absolute) ? absolute : null;
  }

  createReadStream(absolutePath: string): ReturnType<typeof createReadStream> {
    return createReadStream(absolutePath);
  }

  getRootDir(): string {
    return this.rootDir;
  }

  private buildKey(userId: string, scene: UploadScene): string {
    const now = new Date();
    const stamp =
      `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}` +
      `-${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}`;
    const rand = randomBytes(4).toString('hex');
    if (scene === 'avatar') {
      return `avatars/${userId}/avatar-${stamp}-${rand}.jpg`;
    }
    return (
      `bills/${userId}/${now.getFullYear()}/${pad2(now.getMonth() + 1)}/${pad2(now.getDate())}` +
      `/${stamp}-${rand}.jpg`
    );
  }

  private async writeKey(key: string, buffer: Buffer): Promise<void> {
    const absolute = resolve(this.rootDir, key);
    if (!absolute.startsWith(this.rootDir + sep)) {
      storageUnavailable(ERROR_CODES.STORAGE_UNAVAILABLE.message);
    }
    try {
      await mkdir(resolve(absolute, '..'), { recursive: true, mode: 0o700 });
      await this.chmodParentDirs(key);
      await writeFile(absolute, buffer, { mode: 0o600, flag: 'wx' });
      await chmod(absolute, 0o600);
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (
        code === 'ENOSPC' ||
        code === 'EACCES' ||
        code === 'EDQUOT' ||
        code === 'EROFS'
      ) {
        this.logger.error(`写入失败 ${code}: ${key}`);
        storageUnavailable(ERROR_CODES.STORAGE_UNAVAILABLE.message);
      }
      throw error;
    }
  }

  /** 将 key 涉及的新建目录权限收敛为 0700。 */
  private async chmodParentDirs(key: string): Promise<void> {
    const segments = key.split('/').slice(0, -1);
    let current = this.rootDir;
    for (const segment of segments) {
      current = resolve(current, segment);
      await chmod(current, 0o700).catch(() => undefined);
    }
  }

  private safeDecode(key: string): string | null {
    try {
      const decoded = decodeURIComponent(key);
      if (
        decoded.includes('\0') ||
        decoded.includes('\\') ||
        decoded.includes('..')
      ) {
        return null;
      }
      return decoded;
    } catch {
      return null;
    }
  }
}
