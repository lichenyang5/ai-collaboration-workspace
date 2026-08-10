import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Project } from '../database/entities/project.entity';
import {
  Task,
  TaskPriority,
  TaskStatus,
} from '../database/entities/task.entity';
import { TeamMember } from '../database/entities/team-member.entity';
import { User } from '../database/entities/user.entity';
import { CreateTaskDto } from './dto/create-task.dto';

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
      dueDate: input.dueDate ? new Date(input.dueDate) : null,
      project,
      assignee,
    });

    const savedTask = await taskRepository.save(task);
    return this.toTaskSummary(savedTask);
  }

  async getTaskBoard(
    projectId: string,
    userId: string,
  ): Promise<{ projectId: string; teamId: string; columns: TaskBoardColumns }> {
    const project = await this.getAccessibleProject(projectId, userId);
    const taskRepository = this.dataSource.getRepository(Task);
    const tasks = await taskRepository.find({
      where: { project: { id: projectId } },
      relations: { assignee: true },
      order: { createdAt: 'ASC' },
    });
    const columns: TaskBoardColumns = { todo: [], in_progress: [], done: [] };

    for (const task of tasks) {
      columns[task.status].push(this.toTaskSummary(task));
    }

    return { projectId, teamId: project.team.id, columns };
  }

  async updateTaskStatus(
    taskId: string,
    status: TaskStatus,
    userId: string,
  ): Promise<TaskSummary> {
    const taskRepository = this.dataSource.getRepository(Task);
    const task = await taskRepository.findOne({
      where: { id: taskId },
      relations: { project: { team: true } },
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
