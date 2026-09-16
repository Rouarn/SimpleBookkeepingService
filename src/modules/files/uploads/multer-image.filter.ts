import type { Request } from 'express';
import { BusinessException } from '../../../common/exceptions/business.exception.js';
import { ERROR_CODES } from '../../../common/exceptions/error-codes.js';

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const ALLOWED_EXT = /\.(jpe?g|png|webp)$/i;

/**
 * Multer fileFilter：扩展名 + MIME 粗筛（魔术字节精校在 StorageService）。
 * 抛错经全局过滤器归一化为 40000。
 */
export function multerImageFileFilter(
  _req: Request,
  file: { mimetype: string; originalname: string },
  callback: (error: Error | null, acceptFile: boolean) => void,
): void {
  if (ALLOWED_MIME.has(file.mimetype) && ALLOWED_EXT.test(file.originalname)) {
    callback(null, true);
    return;
  }
  callback(
    new BusinessException(
      ERROR_CODES.PARAM_INVALID.code,
      ERROR_CODES.PARAM_INVALID.httpStatus,
      '仅支持 JPEG / PNG / WebP 图片',
    ),
    false,
  );
}
