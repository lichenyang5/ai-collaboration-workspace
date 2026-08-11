import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  And,
  DataSource,
  ILike,
  IsNull,
  LessThan,
  MoreThanOrEqual,
  Not,
  type FindOptionsWhere,
} from 'typeorm';
import { Project } from '../database/entities/project.entity';
import {
  Task,
  TaskPriority,
  TaskStatus,
} from '../database/entities/task.entity';
import { TeamMember } from '../database/entities/team-member.entity';
import { User } from '../database/entities/user.entity';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { CreateTaskBatchDto } from './dto/create-task-batch.dto';
import { TaskBoardQueryDto } from './dto/task-board-query.dto';
import { normalizeUtcDate } from './task-date';

export interface TaskAssigneeSummary {
  id: string;
  displayName: string;
  email: string;
}

export interface TaskSummary {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: Date | null;
  createdAt: Date;
  updatedAt: Date;
  assignee: TaskAssigneeSummary | null;
}

export interface TaskBoardColumns {
  todo: TaskSummary[];
  in_progress: TaskSummary[];
  done: TaskSummary[];
}

@Injectable()
export class TasksService {
  constructor(private readonly dataSource: DataSource) {}

  async createTask(
    input: CreateTaskDto,
    projectId: string,
    userId: string,
  ): Promise<TaskSummary> {
    const project = await this.getAccessibleProject(projectId, userId);
    const taskRepository = this.dataSource.getRepository(Task);
    const assignee = input.assigneeId
      ? await this.getTeamMemberUser(input.assigneeId, project.team.id)
      : null;
    const task = taskRepository.create({
      title: input.title.trim(),
      description: input.description?.trim() ?? '',
      priority: input.priority ?? TaskPriority.Medium,
      status: TaskStatus.Todo,
      dueDate: input.dueDate ? normalizeUtcDate(input.dueDate) : null,
      project,
      assignee,
    });

    const savedTask = await taskRepository.save(task);
    return this.toTaskSummary(savedTask);
  }

  async createTaskBatch(
    input: CreateTaskBatchDto,
    projectId: string,
    userId: string,
  ): Promise<TaskSummary[]> {
    const project = await this.getAccessibleProject(projectId, userId);

    return this.dataSource.transaction(async (entityManager) => {
      const taskRepository = entityManager.getRepository(Task);
      const tasks = input.tasks.map((item) =>
        taskRepository.create({
          title: item.title.trim(),
          description: item.description?.trim() ?? '',
          priority: item.priority,
          status: TaskStatus.Todo,
          dueDate: null,
          project,
          assignee: null,
        }),
      );
      const savedTasks = await taskRepository.save(tasks);
      return savedTasks.map((task) => this.toTaskSummary(task));
    });
  }

  async assertProjectAccess(projectId: string, userId: string): Promise<void> {
    await this.getAccessibleProject(projectId, userId);
  }

  async getTaskBoard(
    projectId: string,
    userId: string,
    query: TaskBoardQueryDto,
  ): Promise<{
    projectId: string;
    projectName: string;
    teamId: string;
    columns: TaskBoardColumns;
  }> {
    const project = await this.getAccessibleProject(projectId, userId);
    const taskRepository = this.dataSource.getRepository(Task);
    const view = query.view ?? 'active';
    const baseWhere: FindOptionsWhere<Task> = {
      project: { id: projectId },
      archivedAt: view === 'archived' ? Not(IsNull()) : IsNull(),
      ...(query.priority ? { priority: query.priority } : {}),
    };
    let assigneeWhere: FindOptionsWhere<Task> = {};
    if (query.assigneeId === 'unassigned') {
      assigneeWhere = { assignee: IsNull() };
    } else if (query.assigneeId) {
      const assignee = await this.getTeamMemberUser(
        query.assigneeId,
        project.team.id,
      );
      assigneeWhere = { assignee: { id: assignee.id } };
    }

    const today = normalizeUtcDate(new Date().toISOString().slice(0, 10));
    const dayAfterDueSoon = new Date(today);
    dayAfterDueSoon.setUTCDate(today.getUTCDate() + 4);
    const dueWhere: FindOptionsWhere<Task>[] = [];
    const withBoardFilters = (condition: FindOptionsWhere<Task> = {}) => ({
      ...baseWhere,
      ...assigneeWhere,
      ...condition,
    });

    switch (query.due) {
      case 'unset':
        dueWhere.push(withBoardFilters({ dueDate: IsNull() }));
        break;
      case 'overdue':
        dueWhere.push(
          withBoardFilters({
            status: Not(TaskStatus.Done),
            dueDate: LessThan(today),
          }),
        );
        break;
      case 'due_soon':
        dueWhere.push(
          withBoardFilters({
            status: Not(TaskStatus.Done),
            dueDate: And(
              MoreThanOrEqual(today),
              LessThan(dayAfterDueSoon),
            ),
          }),
        );
        break;
      case 'normal':
        dueWhere.push(
          withBoardFilters({
            status: TaskStatus.Done,
            dueDate: Not(IsNull()),
          }),
          withBoardFilters({
            status: Not(TaskStatus.Done),
            dueDate: MoreThanOrEqual(dayAfterDueSoon),
          }),
        );
        break;
      default:
        dueWhere.push(withBoardFilters());
    }

    const keyword = query.q?.trim();
    const where = keyword
      ? dueWhere.flatMap((condition) => [
          { ...condition, title: ILike(`%${keyword}%`) },
          { ...condition, description: ILike(`%${keyword}%`) },
        ])
      : dueWhere;
    const tasks = await taskRepository.find({
      where,
      relations: { assignee: true },
      order: { createdAt: 'ASC' },
    });
    const columns: TaskBoardColumns = { todo: [], in_progress: [], done: [] };

    for (const task of tasks) {
      columns[task.status].push(this.toTaskSummary(task));
    }

    return {
      projectId,
      projectName: project.name,
      teamId: project.team.id,
      columns,
    };
  }

  async updateTaskStatus(
    taskId: string,
    status: TaskStatus,
    userId: string,
  ): Promise<TaskSummary> {
    const taskRepository = this.dataSource.getRepository(Task);
    const task = await taskRepository.findOne({
      where: { id: taskId },
      relations: { project: { team: true }, assignee: true },
    });

    if (!task) {
      throw new NotFoundException('任务不存在');
    }

    const membershipRepository = this.dataSource.getRepository(TeamMember);
    const membership = await membershipRepository.findOne({
      where: {
        team: { id: task.project.team.id },
        user: { id: userId },
      },
    });

    if (!membership) {
      throw new ForbiddenException('你不是该团队成员');
    }

    task.status = status;
    const savedTask = await taskRepository.save(task);
    return this.toTaskSummary(savedTask);
  }

  async updateTask(
    taskId: string,
    input: UpdateTaskDto,
    userId: string,
  ): Promise<TaskSummary> {
    const taskRepository = this.dataSource.getRepository(Task);
    const task = await taskRepository.findOne({
      where: { id: taskId },
      relations: { project: { team: true }, assignee: true },
    });

    if (!task) {
      throw new NotFoundException('任务不存在');
    }

    const membershipRepository = this.dataSource.getRepository(TeamMember);
    const membership = await membershipRepository.findOne({
      where: {
        team: { id: task.project.team.id },
        user: { id: userId },
      },
    });

    if (!membership) {
      throw new ForbiddenException('你不是该团队成员');
    }

    if (input.title !== undefined) {
      task.title = input.title.trim();
    }
    if (input.description !== undefined) {
      task.description = input.description.trim();
    }
    if (input.priority !== undefined) {
      task.priority = input.priority;
    }
    if (Object.prototype.hasOwnProperty.call(input, 'dueDate')) {
      task.dueDate = input.dueDate ? normalizeUtcDate(input.dueDate) : null;
    }
    if (Object.prototype.hasOwnProperty.call(input, 'assigneeId')) {
      task.assignee = input.assigneeId
        ? await this.getTeamMemberUser(input.assigneeId, task.project.team.id)
        : null;
    }

    const savedTask = await taskRepository.save(task);
    return this.toTaskSummary(savedTask);
  }

  private async getTeamMemberUser(
    userId: string,
    teamId: string,
  ): Promise<User> {
    const membershipRepository = this.dataSource.getRepository(TeamMember);
    const membership = await membershipRepository.findOne({
      where: { team: { id: teamId }, user: { id: userId } },
      relations: { user: true },
    });

    if (!membership) {
      throw new BadRequestException('负责人必须是该团队成员');
    }

    return membership.user;
  }

  private toTaskSummary(task: Task): TaskSummary {
    return {
      id: task.id,
      title: task.title,
      description: task.description,
      status: task.status,
      priority: task.priority,
      dueDate: task.dueDate,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      assignee: task.assignee
        ? {
            id: task.assignee.id,
            displayName: task.assignee.displayName,
            email: task.assignee.email,
          }
        : null,
    };
  }

  private async getAccessibleProject(
    projectId: string,
    userId: string,
  ): Promise<Project> {
    const projectRepository = this.dataSource.getRepository(Project);
    const project = await projectRepository.findOne({
      where: { id: projectId },
      relations: { team: true },
    });

    if (!project) {
      throw new NotFoundException('项目不存在');
    }

    const membershipRepository = this.dataSource.getRepository(TeamMember);
    const membership = await membershipRepository.findOne({
      where: {
        team: { id: project.team.id },
        user: { id: userId },
      },
    });

    if (!membership) {
      throw new ForbiddenException('你不是该团队成员');
    }

    return project;
  }
}
