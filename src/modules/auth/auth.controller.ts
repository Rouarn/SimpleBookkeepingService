import { Body, Controller, HttpCode, Ip, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator.js';
import {
  CurrentUser,
  type AuthUser,
} from '../../common/decorators/current-user.decorator.js';
import {
  THROTTLE_NAMES,
  THROTTLE_RATES,
} from '../../common/throttler/throttle-rates.js';
import { AuthService } from './services/auth.service.js';
import { RegisterDto } from './dto/register.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { RefreshDto } from './dto/refresh.dto.js';
import { LogoutDto } from './dto/logout.dto.js';

@ApiTags('认证')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @Public()
  @HttpCode(201)
  @Throttle({
    [THROTTLE_NAMES.REGISTER]: {
      limit: THROTTLE_RATES[THROTTLE_NAMES.REGISTER].limit,
      ttl: THROTTLE_RATES[THROTTLE_NAMES.REGISTER].ttl,
    },
  })
  @ApiOperation({ summary: '手机号注册（自动创建默认账本并签发双令牌）' })
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('login')
  @Public()
  @HttpCode(200)
  @Throttle({
    [THROTTLE_NAMES.LOGIN_IP]: {
      limit: THROTTLE_RATES[THROTTLE_NAMES.LOGIN_IP].limit,
      ttl: THROTTLE_RATES[THROTTLE_NAMES.LOGIN_IP].ttl,
    },
  })
  @ApiOperation({ summary: '手机号密码登录' })
  login(@Body() dto: LoginDto, @Ip() ip: string) {
    return this.authService.login(dto, ip ?? '');
  }

  @Post('refresh')
  @Public()
  @HttpCode(200)
  @Throttle({
    [THROTTLE_NAMES.REFRESH]: {
      limit: THROTTLE_RATES[THROTTLE_NAMES.REFRESH].limit,
      ttl: THROTTLE_RATES[THROTTLE_NAMES.REFRESH].ttl,
    },
  })
  @ApiOperation({ summary: '刷新令牌（轮换，重用即全量吊销）' })
  refresh(@Body() dto: RefreshDto) {
    return this.authService.refresh(dto.refreshToken);
  }

  @Post('logout')
  @HttpCode(200)
  @ApiOperation({ summary: '登出并吊销 refresh token' })
  logout(
    @CurrentUser() _user: AuthUser,
    @Body() dto: LogoutDto,
  ): Promise<void> {
    return this.authService.logout(dto.refreshToken);
  }
}
