import { SetMetadata } from '@nestjs/common';

/** 标记免登录路由（JwtAuthGuard 白名单，03 §6.2）。 */
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = (): MethodDecorator & ClassDecorator =>
  SetMetadata(IS_PUBLIC_KEY, true);
