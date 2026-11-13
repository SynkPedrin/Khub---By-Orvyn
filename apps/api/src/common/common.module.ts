import { Global, Module } from '@nestjs/common';
import { MailerService } from './mailer.service';
import { RedisService } from './redis.service';
import { ErrorReporter } from './error-reporter.service';
import { StorageService } from './storage.service';
import { NotificationsService } from './notifications.service';

/** Infra transversal (e-mail, Redis, observabilidade). Global: injeta sem re-importar. */
@Global()
@Module({
  providers: [MailerService, RedisService, ErrorReporter, StorageService, NotificationsService],
  exports: [MailerService, RedisService, ErrorReporter, StorageService, NotificationsService],
})
export class CommonModule {}
