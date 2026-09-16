import { Injectable } from '@nestjs/common';
import { BusinessException } from '../../../common/exceptions/business.exception.js';
import { ERROR_CODES } from '../../../common/exceptions/error-codes.js';

export type DetectedImageType = 'jpg' | 'png' | 'webp';

const MIME_BY_TYPE: Record<DetectedImageType, string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

const EXT_BY_TYPE: Record<DetectedImageType, string[]> = {
  jpg: ['jpg', 'jpeg'],
  png: ['png'],
  webp: ['webp'],
};

const ALLOWED_MIME_TYPES = new Set(Object.values(MIME_BY_TYPE));

function invalidFile(message: string): never {
  throw new BusinessException(
    ERROR_CODES.PARAM_INVALID.code,
    ERROR_CODES.PARAM_INVALID.httpStatus,
    message,
  );
}

/**
 * 上传图片三重校验（04c §10 / 07 §4.2）：
 * 扩展名 → MIME → 魔术字节，三者必须一致且属于 jpg/jpeg/png/webp。
 */
@Injectable()
export class ImageValidatorService {
  /** Multer fileFilter 阶段：扩展名与 MIME 粗筛（魔术字节在内存阶段精校）。 */
  filterByMimeAndExt(mimetype: string, originalName: string): boolean {
    const ext = originalName.split('.').pop()?.toLowerCase() ?? '';
    const mimeAllowed = ALLOWED_MIME_TYPES.has(mimetype);
    const extAllowed = Object.values(EXT_BY_TYPE).some((list) =>
      list.includes(ext),
    );
    return mimeAllowed && extAllowed;
  }

  /** 内存缓冲精校：魔术字节检测真实类型，并要求与声明 MIME 一致。 */
  validate(
    buffer: Buffer,
    declaredMime: string,
    originalName: string,
  ): DetectedImageType {
    const detected = this.detectByMagic(buffer);
    if (!detected) invalidFile('仅支持 JPEG / PNG / WebP 图片');

    const ext = originalName.split('.').pop()?.toLowerCase() ?? '';
    if (!EXT_BY_TYPE[detected].includes(ext)) {
      invalidFile('文件扩展名与真实图片类型不一致');
    }
    if (MIME_BY_TYPE[detected] !== declaredMime) {
      invalidFile('文件 MIME 与真实图片类型不一致');
    }
    if (buffer.length === 0) invalidFile('文件为空');
    return detected;
  }

  assertEdgeAllowed(width: number, height: number, maxEdge: number): void {
    if (
      !Number.isInteger(width) ||
      !Number.isInteger(height) ||
      width < 1 ||
      height < 1 ||
      width > maxEdge ||
      height > maxEdge
    ) {
      invalidFile(`图片边长需在 1~${maxEdge}px 之间`);
    }
  }

  private detectByMagic(buffer: Buffer): DetectedImageType | null {
    if (buffer.length < 12) return null;
    // JPEG: FF D8 FF
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
      return 'jpg';
    }
    // PNG: 89 50 4E 47 0D 0A 1A 0A
    if (
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47 &&
      buffer[4] === 0x0d &&
      buffer[5] === 0x0a &&
      buffer[6] === 0x1a &&
      buffer[7] === 0x0a
    ) {
      return 'png';
    }
    // WebP: 'RIFF' .... 'WEBP'
    if (
      buffer.toString('ascii', 0, 4) === 'RIFF' &&
      buffer.toString('ascii', 8, 12) === 'WEBP'
    ) {
      return 'webp';
    }
    return null;
  }
}
