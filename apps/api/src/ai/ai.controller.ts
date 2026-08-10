import {
  Body,
  Controller,
  Param,
  Post,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import {
  JwtAuthGuard,
  type CurrentUserPayload,
} from '../common/guards/jwt-auth.guard';
import { TasksService } from '../tasks/tasks.service';
import { GenerateTaskDraftsDto } from './dto/generate-task-drafts.dto';
import { SiliconFlowTaskPlanningService } from './siliconflow-task-planning.service';

@Controller('projects/:projectId/ai')
@UseGuards(JwtAuthGuard)
export class AiController {
  constructor(
    private readonly tasksService: TasksService,
    private readonly taskPlanningService: SiliconFlowTaskPlanningService,
  ) {}

  @Post('task-drafts')
  async generateTaskDrafts(
    @Param('projectId') projectId: string,
    @Body(new ValidationPipe({ whitelist: true, transform: true }))
    input: GenerateTaskDraftsDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    await this.tasksService.assertProjectAccess(projectId, user.id);
    return this.taskPlanningService.generateTaskDrafts(input.goal);
  }
}
