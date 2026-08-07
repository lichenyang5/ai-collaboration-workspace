import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { DatabaseModule } from './database/database.module';
import { HealthController } from './health/health.controller';
import { TeamsModule } from './teams/teams.module';

@Module({
  imports: [DatabaseModule, AuthModule, TeamsModule],
  controllers: [HealthController],
})
export class AppModule {}