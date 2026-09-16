import type { User } from '../../../entities/user.entity.js';
import { maskPhone } from '../../../common/utils/phone.util.js';
import {
  formatTimestamp,
  joinDaysOf,
} from '../../../common/utils/date.util.js';
import type { SignedUrlService } from '../../files/services/signed-url.service.js';

/** 注册/登录响应中的用户信息（04a §1/§2）。 */
export interface AuthUserVo {
  id: string;
  phone: string;
  nickname: string;
  avatarUrl: string;
  joinDate: string;
  joinDays: number;
  lastLoginAt?: string;
}

export function buildAuthUserVo(
  user: User,
  signedUrlService: SignedUrlService,
  options: { lastLoginAt?: Date | null } = {},
): AuthUserVo {
  const vo: AuthUserVo = {
    id: String(user.id),
    phone: maskPhone(user.phone),
    nickname: user.nickname,
    avatarUrl: user.avatarUrl ? signedUrlService.sign(user.avatarUrl).url : '',
    joinDate: user.joinDate,
    joinDays: joinDaysOf(user.joinDate),
  };
  const loginAt =
    options.lastLoginAt !== undefined ? options.lastLoginAt : user.lastLoginAt;
  if (loginAt) vo.lastLoginAt = formatTimestamp(new Date(loginAt));
  return vo;
}
