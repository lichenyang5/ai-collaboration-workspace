import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Project } from '../database/entities/project.entity';
import { Task, TaskPriority, TaskStatus } from '../database/entities/task.entity';
import { TeamMember } from '../database/entities/team-member.entity';
import { CreateTaskDto } from './dto/create-task.dto';

export interface TaskBoardColumns {
  todo: Task[];
  in_progress: Task[];
  done: Task[];
}

@Injectable()
export class TasksService {
  constructor(private readonly dataSource: DataSource) {}

  async createTask(
    input: CreateTaskDto,
    projectId: string,
    userId: string,
  ): Promise<Task> {
    const project = await this.getAccessibleProject(projectId, userId);
    const taskRepository = this.dataSource.getRepository(Task);
    const task = taskRepository.create({
      title: input.title.trim(),
      description: input.description?.trim() ?? '',
      priority: input.priority ?? TaskPriority.Medium,
      status: TaskStatus.Todo,
      dueDate: input.dueDate ? new Date(input.dueDate) : null,
      project,
      assignee: null,
    });

    return taskRepository.save(task);
  }

  async getTaskBoard(
    projectId: string,
    userId: string,
  ): Promise<{ projectId: string; columns: TaskBoardColumns }> {
    await this.getAccessibleProject(projectId, userId);
    const taskRepository = this.dataSource.getRepository(Task);
    const tasks = await taskRepository.find({
      where: { project: { id: projectId } },
      relations: { assignee: true },
      order: { createdAt: 'ASC' },
    });
    const columns: TaskBoardColumns = { todo: [], in_progress: [], done: [] };

    for (const task of tasks) {
      columns[task.status].push(task);
    }

    return { projectId, columns };
  }

  private async getAccessibleProject(projectId: string, userId: string): Promise<Project> {
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