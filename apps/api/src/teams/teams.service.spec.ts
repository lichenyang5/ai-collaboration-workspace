import { Logger } from '@nestjs/common';
import { DataSource, QueryFailedError } from 'typeorm';
import {
  TeamMember,
  TeamMemberRole,
} from '../database/entities/team-member.entity';
import { Team } from '../database/entities/team.entity';
import { User } from '../database/entities/user.entity';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { RealtimeNotifier } from '../realtime/realtime-notifier.service';
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
  const savedMembership = {
    id: 'membership-2',
    role: TeamMemberRole.Member,
    user: invitedUser,
    createdAt: new Date('2026-08-14T08:00:00.000Z'),
  } as TeamMember;

  it('returns the existing member summary without saving another membership', async () => {
    const existingMember = teamMember(invitedUser);
    const { service, memberRepository, notifier } = serviceWith({
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
    expect(notifier.notifyTeamMembershipCreated).not.toHaveBeenCalled();
  });

  it('publishes one realtime invitation after saving a new membership', async () => {
    const { service, memberRepository, notifier } = serviceWith({
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
    expect(notifier.notifyTeamMembershipCreated).toHaveBeenCalledWith(
      'member-user-2',
      {
        eventId: 'membership-2',
        teamId: 'team-1',
        teamName: '产品研发组',
        role: 'member',
        occurredAt: '2026-08-14T08:00:00.000Z',
      },
    );
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
    const { service, memberRepository, notifier } = serviceWith({
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
    expect(notifier.notifyTeamMembershipCreated).not.toHaveBeenCalled();
  });

  it('rethrows non-unique save errors unchanged', async () => {
    const saveFailure = new QueryFailedError(
      'INSERT INTO team_members',
      [],
      Object.assign(new Error('foreign key violation'), { code: '23503' }),
    );
    const { service, memberRepository, notifier } = serviceWith({
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
    expect(notifier.notifyTeamMembershipCreated).not.toHaveBeenCalled();
  });

  it('returns the member summary when realtime notification emission fails', async () => {
    const gateway = {
      emitToUser: jest.fn(() => {
        throw new Error('realtime gateway unavailable');
      }),
    } as unknown as RealtimeGateway;
    const notifier = new RealtimeNotifier(gateway);
    const loggerError = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const { service } = serviceWith({
      memberFindOne: jest.fn(async (options) =>
        options.where?.user?.id === 'owner-user-1' ? ownerMembership : null,
      ),
      notifier,
    });

    await expect(
      service.addTeamMember(
        'team-1',
        { email: 'member@example.com' },
        'owner-user-1',
      ),
    ).resolves.toEqual(memberSummary);

    expect((gateway as unknown as { emitToUser: jest.Mock }).emitToUser).toHaveBeenCalledWith(
      'member-user-2',
      'team.membership.created',
      expect.objectContaining({ eventId: 'membership-2' }),
    );
    expect(loggerError).toHaveBeenCalledWith(
      'Failed to emit team.membership.created to user member-user-2',
    );
    loggerError.mockRestore();
  });

  function serviceWith({
    memberFindOne,
    save = jest.fn(async () => savedMembership),
    notifier = { notifyTeamMembershipCreated: jest.fn() },
  }: {
    memberFindOne: jest.Mock;
    save?: jest.Mock;
    notifier?: Pick<RealtimeNotifier, 'notifyTeamMembershipCreated'>;
  }): {
    service: TeamsService;
    memberRepository: {
      findOne: jest.Mock;
      create: jest.Mock;
      save: jest.Mock;
    };
    notifier: Pick<RealtimeNotifier, 'notifyTeamMembershipCreated'>;
  } {
    const memberRepository = {
      findOne: memberFindOne,
      create: jest.fn((member: TeamMember) => member),
      save,
    };
    const userRepository = {
      findOne: jest.fn(async () => invitedUser),
    };
    const teamRepository = {
      findOne: jest.fn(async () => ({ id: 'team-1', name: '产品研发组' })),
    };
    const dataSource = {
      getRepository: jest.fn((entity: unknown) => {
        if (entity === TeamMember) {
          return memberRepository;
        }
        if (entity === User) {
          return userRepository;
        }
        if (entity === Team) {
          return teamRepository;
        }
        throw new Error('Unexpected repository');
      }),
    };

    return {
      service: new TeamsService(
        dataSource as unknown as DataSource,
        notifier as RealtimeNotifier,
      ),
      memberRepository,
      notifier,
    };
  }

  function teamMember(user: User): TeamMember {
    return { ...savedMembership, user } as TeamMember;
  }
});
