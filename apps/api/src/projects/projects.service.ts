import { ForbiddenException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { TeamMember, TeamMemberRole } from '../database/entities/team-member.entity';
import { Project } from '../database/entities/project.entity';
import { Team } from '../database/entities/team.entity';
import { CreateProjectDto } from './dto/create-project.dto';

@Injectable()
export class ProjectsService {
  constructor(private readonly dataSource: DataSource) {}

  async createProject(
    input: CreateProjectDto,
    teamId: string,
    userId: string,
  ): Promise<Project> {
    const membershipRepository = this.dataSource.getRepository(TeamMember);
    const membership = await membershipRepository.findOne({
      where: {
        team: { id: teamId },
        user: { id: userId },
      },
    });

    if (!membership || membership.role !== TeamMemberRole.Owner) {
      throw new ForbiddenException('仅团队负责人可以创建项目');
    }

    const projectRepository = this.dataSource.getRepository(Project);
    const project = projectRepository.create({
      name: input.name.trim(),
      description: input.description?.trim() ?? '',
      team: { id: teamId } as Team,
    });

    return projectRepository.save(project);
  }
}