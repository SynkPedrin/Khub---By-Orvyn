import { Global, Module } from '@nestjs/common';
import { MailerService } from './mailer.service';
import { RedisService } from './redis.service';
import { ErrorReporter } from './error-reporter.service';

/** Infra transversal (e-mail, Redis, observabilidade). Global: injeta sem re-importar. */
@Global()
@Module({
  providers: [MailerService, RedisService, ErrorReporter],
  exports: [MailerService, RedisService, ErrorReporter],
})
export class CommonModule {}
