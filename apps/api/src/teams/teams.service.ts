import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { TeamMember, TeamMemberRole } from '../database/entities/team-member.entity';
import { Team } from '../database/entities/team.entity';
import { User } from '../database/entities/user.entity';
import { CreateTeamDto } from './dto/create-team.dto';

export interface TeamSummary {
  id: string;
  name: string;
  role: TeamMemberRole;
}

@Injectable()
export class TeamsService {
  constructor(private readonly dataSource: DataSource) {}

  async createTeam(input: CreateTeamDto, ownerId: string): Promise<Team> {
    return this.dataSource.transaction(async (manager) => {
      const teamRepository = manager.getRepository(Team);
      const teamMemberRepository = manager.getRepository(TeamMember);
      const team = teamRepository.create({
        name: input.name.trim(),
        createdBy: { id: ownerId } as User,
      });
      const savedTeam = await teamRepository.save(team);
      const ownerMembership = teamMemberRepository.create({
        team: savedTeam,
        user: { id: ownerId } as User,
        role: TeamMemberRole.Owner,
      });
      await teamMemberRepository.save(ownerMembership);
      return savedTeam;
    });
  }

  async getTeamsForUser(userId: string): Promise<TeamSummary[]> {
    const teamMemberRepository = this.dataSource.getRepository(TeamMember);
    const memberships = await teamMemberRepository.find({
      where: { user: { id: userId } },
      relations: { team: true },
      order: { createdAt: 'ASC' },
    });

    return memberships.map((membership) => ({
      id: membership.team.id,
      name: membership.team.name,
      role: membership.role,
    }));
  }
}