import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { OAuthService } from './oauth.service';
import { AuthController } from './auth.controller';
import { TokenService } from './token.service';
import { PasswordResetService } from './password-reset.service';
import { TenantsModule } from '../tenants/tenants.module';

@Module({
  imports: [
    TenantsModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET,
      signOptions: { expiresIn: process.env.JWT_ACCESS_TTL ?? '15m' },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, OAuthService, TokenService, PasswordResetService],
  exports: [JwtModule, TokenService],
})
export class AuthModule {}
