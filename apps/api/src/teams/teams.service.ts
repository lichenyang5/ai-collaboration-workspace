import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { TeamMemberRole } from '../database/entities/team-member.entity';
import { TeamMember } from '../database/entities/team-member.entity';
import { Team } from '../database/entities/team.entity';
import { User } from '../database/entities/user.entity';
import { CreateTeamDto } from './dto/create-team.dto';

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
}