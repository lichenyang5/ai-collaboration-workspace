import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RealtimeAuthService } from './realtime-auth.service';
import { RealtimeGateway } from './realtime.gateway';
import { RealtimeNotifier } from './realtime-notifier.service';

@Module({
  imports: [AuthModule],
  providers: [RealtimeAuthService, RealtimeGateway, RealtimeNotifier],
  exports: [RealtimeNotifier],
})
export class RealtimeModule {}
