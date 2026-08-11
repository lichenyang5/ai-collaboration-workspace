import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import {
  JwtAuthGuard,
  type CurrentUserPayload,
} from '../common/guards/jwt-auth.guard';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskStatusDto } from './dto/update-task-status.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { CreateTaskBatchDto } from './dto/create-task-batch.dto';
import { TaskBoardQueryDto } from './dto/task-board-query.dto';
import { TasksService } from './tasks.service';

@Controller()
@UseGuards(JwtAuthGuard)
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  @Post('projects/:projectId/tasks')
  createTask(
    @Param('projectId') projectId: string,
    @Body(new ValidationPipe({ whitelist: true, transform: true }))
    input: CreateTaskDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.tasksService.createTask(input, projectId, user.id);
  }

  @Post('projects/:projectId/tasks/batch')
  createTaskBatch(
    @Param('projectId') projectId: string,
    @Body(new ValidationPipe({ whitelist: true, transform: true }))
    input: CreateTaskBatchDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.tasksService.createTaskBatch(input, projectId, user.id);
  }

  @Get('projects/:projectId/tasks')
  getTaskBoard(
    @Param('projectId') projectId: string,
    @Query(new ValidationPipe({ whitelist: true, transform: true }))
    query: TaskBoardQueryDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.tasksService.getTaskBoard(projectId, user.id, query);
  }

  @Get('projects/:projectId/task-activities')
  getTaskActivities(
    @Param('projectId') projectId: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.tasksService.getTaskActivities(projectId, user.id);
  }

  @Patch('tasks/:taskId/status')
  updateTaskStatus(
    @Param('taskId') taskId: string,
    @Body(new ValidationPipe({ whitelist: true, transform: true }))
    input: UpdateTaskStatusDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.tasksService.updateTaskStatus(taskId, input.status, user.id);
  }

  @Patch('tasks/:taskId')
  updateTask(
    @Param('taskId') taskId: string,
    @Body(new ValidationPipe({ whitelist: true, transform: true }))
    input: UpdateTaskDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.tasksService.updateTask(taskId, input, user.id);
  }
}
