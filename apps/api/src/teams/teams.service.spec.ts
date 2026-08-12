import { DataSource, QueryFailedError } from 'typeorm';
import {
  TeamMember,
  TeamMemberRole,
} from '../database/entities/team-member.entity';
import { User } from '../database/entities/user.entity';
import { TeamsService } from './teams.service';

describe('TeamsService addTeamMember', () => {
  const ownerMembership = {
    id: 'owner-membership-1',
    role: TeamMemberRole.Owner,
  } as TeamMember;
  const invitedUser = {
    id: 'member-user-2',
    displayName: '成员二',
    email: 'member@example.com',
  } as User;
  const memberSummary = {
    id: 'member-user-2',
    displayName: '成员二',
    email: 'member@example.com',
    role: TeamMemberRole.Member,
  };

  it('returns the existing member summary without saving another membership', async () => {
    const existingMember = teamMember(invitedUser);
    const { service, memberRepository } = serviceWith({
      memberFindOne: jest.fn(async (options) =>
        options.where?.user?.id === 'owner-user-1'
          ? ownerMembership
          : existingMember,
      ),
    });

    await expect(
      service.addTeamMember(
        'team-1',
        { email: 'member@example.com' },
        'owner-user-1',
      ),
    ).resolves.toEqual(memberSummary);

    expect(memberRepository.findOne).toHaveBeenLastCalledWith({
      where: { team: { id: 'team-1' }, user: { id: 'member-user-2' } },
      relations: { user: true },
    });
    expect(memberRepository.save).not.toHaveBeenCalled();
  });

  it('creates and saves one new membership before returning its public summary', async () => {
    const { service, memberRepository } = serviceWith({
      memberFindOne: jest.fn(async (options) =>
        options.where?.user?.id === 'owner-user-1' ? ownerMembership : null,
      ),
    });

    await expect(
      service.addTeamMember(
        'team-1',
        { email: 'member@example.com' },
        'owner-user-1',
      ),
    ).resolves.toEqual(memberSummary);

    expect(memberRepository.create).toHaveBeenCalledWith({
      team: { id: 'team-1' },
      user: invitedUser,
      role: TeamMemberRole.Member,
    });
    expect(memberRepository.create).toHaveBeenCalledTimes(1);
    expect(memberRepository.save).toHaveBeenCalledTimes(1);
  });

  it('recovers the persisted membership after a concurrent unique-constraint save failure', async () => {
    const persistedMember = teamMember(invitedUser);
    const uniqueViolation = new QueryFailedError(
      'INSERT INTO team_members',
      [],
      Object.assign(new Error('duplicate key value'), { code: '23505' }),
    );
    const memberFindOne = jest.fn(async (options) => {
      if (options.where?.user?.id === 'owner-user-1') {
        return ownerMembership;
      }

      return memberFindOne.mock.calls.length === 2 ? null : persistedMember;
    });
    const { service, memberRepository } = serviceWith({
      memberFindOne,
      save: jest.fn(async () => {
        throw uniqueViolation;
      }),
    });

    await expect(
      service.addTeamMember(
        'team-1',
        { email: 'member@example.com' },
        'owner-user-1',
      ),
    ).resolves.toEqual(memberSummary);

    expect(memberRepository.findOne).toHaveBeenLastCalledWith({
      where: { team: { id: 'team-1' }, user: { id: 'member-user-2' } },
      relations: { user: true },
    });
    expect(memberRepository.save).toHaveBeenCalledTimes(1);
    expect(memberRepository.findOne).toHaveBeenCalledTimes(3);
  });

  it('rethrows non-unique save errors unchanged', async () => {
    const saveFailure = new QueryFailedError(
      'INSERT INTO team_members',
      [],
      Object.assign(new Error('foreign key violation'), { code: '23503' }),
    );
    const { service, memberRepository } = serviceWith({
      memberFindOne: jest.fn(async (options) =>
        options.where?.user?.id === 'owner-user-1' ? ownerMembership : null,
      ),
      save: jest.fn(async () => {
        throw saveFailure;
      }),
    });

    await expect(
      service.addTeamMember(
        'team-1',
        { email: 'member@example.com' },
        'owner-user-1',
      ),
    ).rejects.toBe(saveFailure);

    expect(memberRepository.findOne).toHaveBeenCalledTimes(2);
  });

  function serviceWith({
    memberFindOne,
    save = jest.fn(async (member: TeamMember) => member),
  }: {
    memberFindOne: jest.Mock;
    save?: jest.Mock;
  }): {
    service: TeamsService;
    memberRepository: {
      findOne: jest.Mock;
      create: jest.Mock;
      save: jest.Mock;
    };
  } {
    const memberRepository = {
      findOne: memberFindOne,
      create: jest.fn((member: TeamMember) => member),
      save,
    };
    const userRepository = {
      findOne: jest.fn(async () => invitedUser),
    };
    const dataSource = {
      getRepository: jest.fn((entity: unknown) => {
        if (entity === TeamMember) {
          return memberRepository;
        }
        if (entity === User) {
          return userRepository;
        }
        throw new Error('Unexpected repository');
      }),
    };

    return {
      service: new TeamsService(dataSource as unknown as DataSource),
      memberRepository,
    };
  }

  function teamMember(user: User): TeamMember {
    return {
      id: 'membership-2',
      role: TeamMemberRole.Member,
      user,
    } as TeamMember;
  }
});
