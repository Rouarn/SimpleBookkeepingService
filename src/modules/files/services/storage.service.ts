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
import { createReadStream } from 'node:fs';
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

/** wx 独占写发生 EEXIST 碰撞时的最大尝试次数（含首次写入） */
const KEY_WRITE_MAX_ATTEMPTS = 3;

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

    // wx 独占写碰撞（EEXIST）时重新生成随机 key 重试，最多 3 次，而非直接 500
    let key = '';
    let written = false;
    for (let attempt = 1; attempt <= KEY_WRITE_MAX_ATTEMPTS; attempt += 1) {
      key = this.buildKey(userId, scene);
      try {
        await this.writeKey(key, output);
        written = true;
        break;
      } catch (error) {
        if ((error as { code?: string }).code !== 'EEXIST') throw error;
        this.logger.warn(`文件名碰撞，第 ${attempt} 次重新生成 key: ${key}`);
      }
    }
    if (!written) {
      this.logger.error('文件名连续碰撞，写入失败');
      storageUnavailable(ERROR_CODES.STORAGE_UNAVAILABLE.message);
    }

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
   * 存在性检查用异步 access 替代同步 existsSync：图片端点为全站最高频
   * 端点，同步磁盘 IO 在磁盘繁忙时会阻塞事件循环。
   */
  async resolveExistingFile(key: string): Promise<string | null> {
    if (!KEY_PATTERN.test(key)) return null;
    const decoded = this.safeDecode(key);
    if (!decoded) return null;

    const absolute = resolve(this.rootDir, decoded);
    if (absolute !== this.rootDir && !absolute.startsWith(this.rootDir + sep)) {
      return null;
    }
    try {
      await access(absolute, fsConstants.R_OK);
      return absolute;
    } catch {
      return null;
    }
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
    // crypto.randomBytes 随机源 16 字节 → 32 位 hex，防文件名猜测与碰撞
    const rand = randomBytes(16).toString('hex');
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
      await this.ensureParentDir(absolute);
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

  /**
   * 确保父目录存在且权限收敛：
   * 仅当叶子目录（账单场景即当日 YYYY/MM/DD 目录、头像场景即用户目录）
   * 为本次写入新建时 chmod 0700 一次；已存在目录一律不重复 chmod，
   * 避免每次上传都对全路径逐级 chmod。新建的中间目录由 mkdir mode 0o700 指定权限。
   */
  private async ensureParentDir(absolute: string): Promise<void> {
    const parent = resolve(absolute, '..');
    let newlyCreated = false;
    try {
      await access(parent, fsConstants.R_OK | fsConstants.W_OK);
    } catch {
      newlyCreated = true;
    }
    await mkdir(parent, { recursive: true, mode: 0o700 });
    if (newlyCreated) {
      await chmod(parent, 0o700).catch(() => undefined);
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
