import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { SignedUrlService } from '../services/signed-url.service.js';
import { StorageService } from '../services/storage.service.js';

const FILES_PREFIX = '/api/v1/files/';

/** 附加了签名文件绝对路径的请求类型（守卫解析一次，控制器直接复用）。 */
export type FileSignRequest = Request & { fileAbsolutePath?: string };

/**
 * 文件签名守卫（04c §11）：
 * sign = HMAC_SHA256(secret, key+'.'+e) 且 e 未过期 + 路径合法且文件存在。
 * 失败一律裸 403（不区分签名错误与不存在，防探测；图片端点不走统一信封）。
 * 签名校验通过后异步解析出绝对路径挂到 request.fileAbsolutePath，
 * 控制器直接复用，避免同一请求重复执行同步磁盘检查。
 */
@Injectable()
export class FileSignGuard implements CanActivate {
  constructor(
    private readonly signedUrlService: SignedUrlService,
    private readonly storageService: StorageService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<FileSignRequest>();
    const response = http.getResponse<Response>();

    const deny = (): boolean => {
      response.status(403).type('text/plain').end('Forbidden');
      return false;
    };

    const key = this.extractKey(request.originalUrl ?? request.url ?? '');
    if (!key) return deny();

    const exp = Number(request.query.e);
    const sign =
      typeof request.query.sign === 'string' ? request.query.sign : '';
    if (!this.signedUrlService.verify(key, exp, sign)) return deny();

    const absolutePath = await this.storageService.resolveExistingFile(key);
    if (absolutePath === null) return deny();
    request.fileAbsolutePath = absolutePath;

    return true;
  }

  private extractKey(url: string): string {
    const path = url.split('?')[0] ?? '';
    if (!path.startsWith(FILES_PREFIX)) return '';
    try {
      return decodeURIComponent(path.slice(FILES_PREFIX.length));
    } catch {
      return '';
    }
  }
}
