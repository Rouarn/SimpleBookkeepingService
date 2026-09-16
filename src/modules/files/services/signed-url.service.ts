import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { AppConfig } from '../../../config/configuration.js';
import { formatTimestamp } from '../../../common/utils/date.util.js';

export interface SignedFileUrl {
  url: string;
  expiresAt: string;
  expiresIn: number;
}

/**
 * 文件访问签名（03 §8 / 07 §4.3）：
 * sign = HMAC_SHA256(FILES_SIGN_SECRET, key + '.' + e)，默认 12h 有效。
 */
@Injectable()
export class SignedUrlService {
  private readonly filesBaseUrl: string;
  private readonly secret: string;
  private readonly ttlSeconds: number;

  constructor(private readonly configService: ConfigService) {
    const uploadsConfig =
      this.configService.get<AppConfig['uploads']>('uploads')!;
    this.filesBaseUrl = uploadsConfig.filesBaseUrl.replace(/\/+$/, '');
    this.secret = uploadsConfig.filesSignSecret;
    this.ttlSeconds = uploadsConfig.filesLinkTtlSeconds;
  }

  /** 为相对路径 key 生成临时签名访问 URL。 */
  sign(key: string, ttlSeconds: number = this.ttlSeconds): SignedFileUrl {
    const safeKey = key
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/');
    const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
    const signature = this.computeSignature(key, exp);
    return {
      url: `${this.filesBaseUrl}/${safeKey}?e=${exp}&sign=${signature}`,
      expiresAt: formatTimestamp(new Date(exp * 1000)),
      expiresIn: ttlSeconds,
    };
  }

  /** 校验签名与过期时间（常量时间比较，防时序探测）。 */
  verify(
    key: string,
    exp: number,
    sign: string,
    nowSeconds: number = Math.floor(Date.now() / 1000),
  ): boolean {
    if (!Number.isInteger(exp) || exp <= nowSeconds) return false;
    if (!/^[a-f0-9]{64}$/i.test(sign)) return false;
    const expected = this.computeSignature(key, exp);
    try {
      return timingSafeEqual(
        Buffer.from(sign.toLowerCase(), 'hex'),
        Buffer.from(expected, 'hex'),
      );
    } catch {
      return false;
    }
  }

  private computeSignature(key: string, exp: number): string {
    return createHmac('sha256', this.secret)
      .update(`${key}.${exp}`)
      .digest('hex');
  }
}
