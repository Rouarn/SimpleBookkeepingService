import { SetMetadata } from '@nestjs/common';

/** 标记该路由超限使用上传专属错误码 42901（03 §4.2）。 */
export const UPLOAD_THROTTLE_KEY = 'bk:upload-throttle';
export const UploadThrottle = (): MethodDecorator & ClassDecorator =>
  SetMetadata(UPLOAD_THROTTLE_KEY, true);
