import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { Team } from './team.entity';
import { User } from './user.entity';

export enum TeamMemberRole {
  Owner = 'owner',
  Member = 'member',
}

@Entity({ name: 'team_members' })
@Unique(['team', 'user'])
export class TeamMember {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => Team, (team) => team.members, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'team_id' })
  team!: Team;

  @ManyToOne(() => User, (user) => user.teamMemberships, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @Column({ type: 'enum', enum: TeamMemberRole })
  role!: TeamMemberRole;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}