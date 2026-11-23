import { Module } from '@nestjs/common';
import { AgencyModule } from '../agency/agency.module';
import { GennaModule } from '../integrations/genna/genna.module';
import { NyroModule } from '../nyro/nyro.module';
import { OnboardingController } from './onboarding.controller';
import { OnboardingNyro } from './onboarding-nyro';
import { OnboardingService } from './onboarding.service';

/**
 * Onboarding KROMA (db/078). AgencyModule dá o escopo da agência
 * (AgencyService.escopo); GennaModule dá as consultas de leitura ao Genna da
 * subconta (ADR-0053). NyroModule dá o executor onde as tools de onboarding do
 * catálogo da NICO registram o dispatch (registrarHandler — sem ciclo de
 * import). PrismaService é global (PrismaModule).
 */
@Module({
  imports: [AgencyModule, GennaModule, NyroModule],
  controllers: [OnboardingController],
  providers: [OnboardingService, OnboardingNyro],
})
export class OnboardingModule {}
