import { Module } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { SettingsController } from './settings.controller';
import { AdvancedSettingsController } from './advanced.controller';
import { TagsService } from './tags.service';
import { ApiKeysService } from './api-keys.service';

@Module({
  controllers: [SettingsController, AdvancedSettingsController],
  providers: [SettingsService, TagsService, ApiKeysService],
})
export class SettingsModule {}
