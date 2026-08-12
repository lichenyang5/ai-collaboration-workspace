import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, QueryFailedError } from 'typeorm';
import {
  TeamMember,
  TeamMemberRole,
} from '../database/entities/team-member.entity';
import { Team } from '../database/entities/team.entity';
import { User } from '../database/entities/user.entity';
import { CreateTeamDto } from './dto/create-team.dto';
import { AddTeamMemberDto } from './dto/add-team-member.dto';

export interface TeamSummary {
  id: string;
  name: string;
  role: TeamMemberRole;
}

export interface TeamMemberSummary {
  id: string;
  displayName: string;
  email: string;
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

  async getTeamMembers(
    teamId: string,
    requesterId: string,
  ): Promise<TeamMemberSummary[]> {
    await this.requireMembership(teamId, requesterId);
    const teamMemberRepository = this.dataSource.getRepository(TeamMember);
    const members = await teamMemberRepository.find({
      where: { team: { id: teamId } },
      relations: { user: true },
      order: { createdAt: 'ASC' },
    });

    return members.map((member) => this.toTeamMemberSummary(member));
  }

  async addTeamMember(
    teamId: string,
    input: AddTeamMemberDto,
    requesterId: string,
  ): Promise<TeamMemberSummary> {
    await this.requireOwner(teamId, requesterId);
    const userRepository = this.dataSource.getRepository(User);
    const user = await userRepository.findOne({
      where: { email: input.email.trim().toLowerCase() },
    });

    if (!user) {
      throw new NotFoundException('未找到该邮箱对应的已注册用户');
    }

    const teamMemberRepository = this.dataSource.getRepository(TeamMember);
    const existingMember = await teamMemberRepository.findOne({
      where: { team: { id: teamId }, user: { id: user.id } },
      relations: { user: true },
    });

    if (existingMember) {
      return this.toTeamMemberSummary(existingMember);
    }

    const member = teamMemberRepository.create({
      team: { id: teamId } as Team,
      user,
      role: TeamMemberRole.Member,
    });
    try {
      await teamMemberRepository.save(member);
    } catch (error) {
      if (
        !(error instanceof QueryFailedError) ||
        (error.driverError as { code?: unknown }).code !== '23505'
      ) {
        throw error;
      }

      const persistedMember = await teamMemberRepository.findOne({
        where: { team: { id: teamId }, user: { id: user.id } },
        relations: { user: true },
      });

      if (persistedMember) {
        return this.toTeamMemberSummary(persistedMember);
      }

      throw error;
    }

    return this.toTeamMemberSummary(member);
  }

  private async requireMembership(
    teamId: string,
    userId: string,
  ): Promise<TeamMember> {
    const teamMemberRepository = this.dataSource.getRepository(TeamMember);
    const membership = await teamMemberRepository.findOne({
      where: { team: { id: teamId }, user: { id: userId } },
    });

    if (!membership) {
      throw new ForbiddenException('你不是该团队成员');
    }

    return membership;
  }

  private async requireOwner(teamId: string, userId: string): Promise<void> {
    const membership = await this.requireMembership(teamId, userId);
    if (membership.role !== TeamMemberRole.Owner) {
      throw new ForbiddenException('只有团队负责人可以邀请成员');
    }
  }

  private toTeamMemberSummary(member: TeamMember): TeamMemberSummary {
    return {
      id: member.user.id,
      displayName: member.user.displayName,
      email: member.user.email,
      role: member.role,
    };
  }
}
