import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Project } from './project.entity';
import { TeamMember } from './team-member.entity';
import { User } from './user.entity';

@Entity({ name: 'teams' })
export class Team {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ length: 120 })
  name!: string;

  @ManyToOne(() => User, (user) => user.createdTeams, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'created_by_id' })
  createdBy!: User;

  @OneToMany(() => TeamMember, (member) => member.team)
  members!: TeamMember[];

  @OneToMany(() => Project, (project) => project.team)
  projects!: Project[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}