import { Body, Controller, HttpCode, Post, Res, ValidationPipe } from '@nestjs/common';
import type { Response } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  async register(
    @Body(new ValidationPipe({ whitelist: true, transform: true })) input: RegisterDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.authService.register(input);
    this.setAccessTokenCookie(response, result.accessToken);
    return { user: result.user };
  }

  @Post('login')
  @HttpCode(200)
  async login(
    @Body(new ValidationPipe({ whitelist: true, transform: true })) input: LoginDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.authService.login(input);
    this.setAccessTokenCookie(response, result.accessToken);
    return { user: result.user };
  }

  @Post('logout')
  @HttpCode(204)
  logout(@Res({ passthrough: true }) response: Response): void {
    response.clearCookie('access_token', { httpOnly: true, sameSite: 'lax' });
  }

  private setAccessTokenCookie(response: Response, accessToken: string): void {
    response.cookie('access_token', accessToken, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 1000 * 60 * 60 * 24,
    });
  }
}