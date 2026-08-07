import { Module, type ModuleMetadata } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Project } from './entities/project.entity';
import { Task } from './entities/task.entity';
import { TeamMember } from './entities/team-member.entity';
import { Team } from './entities/team.entity';
import { User } from './entities/user.entity';

const entities = [User, Team, TeamMember, Project, Task];
const databaseImports: NonNullable<ModuleMetadata['imports']> = [
  ConfigModule.forRoot({ isGlobal: true }),
];

if (process.env.NODE_ENV !== 'test') {
  databaseImports.push(
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres' as const,
        url: configService.getOrThrow<string>('DATABASE_URL'),
        entities,
        synchronize: false,
      }),
    }),
  );
}

@Module({
  imports: databaseImports,
})
export class DatabaseModule {}