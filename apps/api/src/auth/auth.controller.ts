import { Body, Controller, Get, Headers, HttpCode, NotImplementedException, Post } from '@nestjs/common';
import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { AuthService } from './auth.service';
import { CurrentUser, Public, type AuthUser } from './decorators';

class SignupDto {
  @IsEmail() email!: string;
  @IsString() @MinLength(8) @MaxLength(200) password!: string;
  @IsString() @MaxLength(160) nome!: string;
  @IsOptional() @IsString() @MaxLength(160) empresa?: string;
  @IsOptional() @IsString() @MaxLength(80) nicho?: string;
}
class LoginDto {
  @IsEmail() email!: string;
  @IsString() @MinLength(1) password!: string;
}
class RefreshDto {
  @IsString() refresh!: string;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('signup')
  signup(@Body() dto: SignupDto, @Headers('user-agent') ua?: string) {
    return this.auth.signup(dto, ua);
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto, @Headers('user-agent') ua?: string) {
    return this.auth.login(dto.email, dto.password, ua);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() dto: RefreshDto, @Headers('user-agent') ua?: string) {
    return this.auth.refresh(dto.refresh, ua);
  }

  @Public()
  @Post('logout')
  @HttpCode(200)
  async logout(@Body() dto: RefreshDto) {
    await this.auth.logout(dto.refresh);
    return { ok: true };
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user.identityId, user.tenantId);
  }

  @Public()
  @Post('oauth/callback')
  oauthCallback() {
    // OAuth plugável: sem credenciais, falha EXPLÍCITA (nunca mock silencioso).
    throw new NotImplementedException('OAuth não configurado. Defina GOOGLE_CLIENT_ID/SECRET, GITHUB_ID/SECRET e AUTH_SECRET para habilitar Google/GitHub.');
  }
}
