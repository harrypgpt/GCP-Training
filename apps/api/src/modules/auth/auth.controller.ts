import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { type Request, type Response } from 'express';

import {
  UserRole,
  type LoginResponse,
  type MeResponse,
  type VerifyEmailResponse,
} from '@gcp/shared';

import { Roles } from '../../common/rbac/roles.decorator';
import { AppConfigService } from '../../config/app-config.service';
import { AuthService } from './auth.service';
import { CurrentUser } from './current-user.decorator';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { SetPasswordDto } from './dto/set-password.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { AUTH_THROTTLE } from './auth.constants';
import { Public, type RequestUser } from './jwt-auth.guard';

const REFRESH_COOKIE = 'refresh_token';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: AppConfigService,
  ) {}

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('register')
  @HttpCode(HttpStatus.OK)
  async register(@Body() dto: RegisterDto): Promise<{ message: string }> {
    await this.auth.register(dto.email);
    return { message: 'A verification code has been sent to your email.' };
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  async verifyEmail(@Body() dto: VerifyEmailDto): Promise<VerifyEmailResponse> {
    const token = await this.auth.verifyEmail(dto.email, dto.code);
    return { emailVerificationToken: token.token, expiresInSeconds: token.expiresInSeconds };
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('set-password')
  @HttpCode(HttpStatus.OK)
  async setPassword(@Body() dto: SetPasswordDto): Promise<{ message: string }> {
    await this.auth.setPassword(dto.emailVerificationToken, dto.password);
    return { message: 'Password set successfully. You can now log in.' };
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponse> {
    const session = await this.auth.login(dto.email, dto.password);
    this.setRefreshCookie(res, session.refreshToken, session.refreshTokenExpiresAt);
    return {
      accessToken: session.accessToken.token,
      tokenType: 'Bearer',
      expiresInSeconds: session.accessToken.expiresInSeconds,
    };
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponse> {
    const presented = this.readRefreshCookie(req);
    const session = await this.auth.refresh(presented);
    this.setRefreshCookie(res, session.refreshToken, session.refreshTokenExpiresAt);
    return {
      accessToken: session.accessToken.token,
      tokenType: 'Bearer',
      expiresInSeconds: session.accessToken.expiresInSeconds,
    };
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    const presented = this.readRefreshCookie(req);
    if (presented) {
      await this.auth.logout(presented);
    }
    res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
  }

  @Get('me')
  async me(@CurrentUser() user: RequestUser): Promise<MeResponse> {
    const view = await this.auth.me(user.id);
    return view;
  }

  /** Minimal demonstration that the RBAC pipeline (guard + roles) is wired end to end. */
  @Roles([UserRole.ADMIN])
  @Get('admin-check')
  adminCheck(): { ok: true } {
    return { ok: true };
  }

  private setRefreshCookie(res: Response, token: string, expiresAt: Date): void {
    res.cookie(REFRESH_COOKIE, token, {
      httpOnly: true,
      secure: this.config.isProduction,
      sameSite: 'lax',
      path: '/api/auth',
      expires: expiresAt,
    });
  }

  private readRefreshCookie(req: Request): string {
    const cookies = req.cookies as Record<string, string | undefined> | undefined;
    const token = cookies?.[REFRESH_COOKIE];
    if (!token) {
      return '';
    }
    return token;
  }
}
