import { BadRequestException, Body, Controller, Get, Headers, HttpCode, Param, Post, Query } from '@nestjs/common';
import { IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { AuthService } from './auth.service';
import { OAuthService } from './oauth.service';
import { PasswordResetService } from './password-reset.service';
import { ehProvider, type OAuthProvider } from './oauth.providers';
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
class AcceptInviteDto {
  @IsString() @MinLength(10) token!: string;
  @IsOptional() @IsString() @MaxLength(160) nome?: string;
  @IsOptional() @IsString() @MinLength(8) @MaxLength(200) password?: string;
}
class ForgotPasswordDto {
  @IsEmail() @MaxLength(200) email!: string;
}
class ResetPasswordDto {
  @IsString() @MinLength(20) @MaxLength(200) token!: string;
  @IsString() @MinLength(8) @MaxLength(200) password!: string;
}
class OAuthCallbackDto {
  @IsIn(['google', 'github']) provider!: OAuthProvider;
  @IsString() @MinLength(1) @MaxLength(2000) code!: string;
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly oauth: OAuthService,
    private readonly senhas: PasswordResetService,
  ) {}

  /** A tela de login só oferece o fluxo por e-mail se o envio estiver configurado. */
  @Public()
  @Get('password/status')
  passwordStatus() {
    return this.senhas.disponivel();
  }

  /** Sempre 200 com a mesma resposta: não revela se o e-mail tem conta. */
  @Public()
  @Post('password/forgot')
  @HttpCode(200)
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.senhas.solicitar(dto.email);
  }

  /** Token de uso único do e-mail + nova senha. Encerra todas as sessões. */
  @Public()
  @Post('password/reset')
  @HttpCode(200)
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.senhas.redefinir(dto.token, dto.password);
  }

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

  /** Aceite de convite — público (o token do link é a credencial). */
  @Public()
  @Post('invites/accept')
  @HttpCode(200)
  acceptInvite(@Body() dto: AcceptInviteDto, @Headers('user-agent') ua?: string) {
    return this.auth.acceptInvite(dto.token, dto.nome, dto.password, ua);
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user.identityId, user.tenantId);
  }

  /**
   * Ticket de WebSocket (D2/ADR-0011): o access token fica em cookie httpOnly,
   * então o JS não pode usá-lo no handshake. Troca-se por um ticket de 60s que
   * só serve para abrir socket.
   */
  @Post('ws-ticket')
  @HttpCode(200)
  wsTicket(@CurrentUser() user: AuthUser) {
    return { ticket: this.auth.wsTicket(user), expiraEmSegundos: 60 };
  }

  /** URL de consentimento do provedor. Gated: 501 config_required sem as chaves. */
  @Public()
  @Get('oauth/:provider/url')
  oauthUrl(@Param('provider') provider: string, @Query('state') state?: string) {
    if (!ehProvider(provider)) throw new BadRequestException('provedor inválido');
    if (!state || state.length < 8) throw new BadRequestException('state ausente');
    return { url: this.oauth.authUrl(provider, state) };
  }

  /** Callback: troca o code por sessão (cria a conta no 1º acesso). */
  @Public()
  @Post('oauth/callback')
  @HttpCode(200)
  oauthCallback(@Body() dto: OAuthCallbackDto, @Headers('user-agent') ua?: string) {
    return this.oauth.callback(dto.provider, dto.code, ua);
  }
}
