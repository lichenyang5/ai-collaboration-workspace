import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TasksModule } from '../tasks/tasks.module';
import { AiController } from './ai.controller';
import { SiliconFlowTaskPlanningService } from './siliconflow-task-planning.service';

@Module({
  imports: [AuthModule, TasksModule],
  controllers: [AiController],
  providers: [SiliconFlowTaskPlanningService],
  exports: [SiliconFlowTaskPlanningService],
})
export class AiModule {}
