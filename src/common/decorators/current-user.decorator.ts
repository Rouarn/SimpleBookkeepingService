import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

/** JWT 鉴权后注入的登录用户信息（取自令牌，绝不信任客户端传入的 userId）。 */
export interface AuthUser {
  id: string;
  jti: string;
}

function getRequestUser(context: ExecutionContext): AuthUser | undefined {
  const request = context.switchToHttp().getRequest<{ user?: AuthUser }>();
  return request.user;
}

/** 取整个登录用户：`@CurrentUser() user: AuthUser` */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext) => getRequestUser(context),
);

/** 只取登录用户 id：`@CurrentUserId() userId: string` */
export const CurrentUserId = createParamDecorator(
  (_data: unknown, context: ExecutionContext) => getRequestUser(context)?.id,
);
