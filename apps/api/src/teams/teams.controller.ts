import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import {
  JwtAuthGuard,
  type CurrentUserPayload,
} from '../common/guards/jwt-auth.guard';
import { CreateTeamDto } from './dto/create-team.dto';
import { AddTeamMemberDto } from './dto/add-team-member.dto';
import { TeamsService } from './teams.service';

@Controller('teams')
@UseGuards(JwtAuthGuard)
export class TeamsController {
  constructor(private readonly teamsService: TeamsService) {}

  @Post()
  createTeam(
    @Body(new ValidationPipe({ whitelist: true, transform: true }))
    input: CreateTeamDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.teamsService.createTeam(input, user.id);
  }

  @Get()
  getTeams(@CurrentUser() user: CurrentUserPayload) {
    return this.teamsService.getTeamsForUser(user.id);
  }

  @Get(':teamId/members')
  getTeamMembers(
    @Param('teamId') teamId: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.teamsService.getTeamMembers(teamId, user.id);
  }

  @Post(':teamId/members')
  addTeamMember(
    @Param('teamId') teamId: string,
    @Body(new ValidationPipe({ whitelist: true, transform: true }))
    input: AddTeamMemberDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.teamsService.addTeamMember(teamId, input, user.id);
  }
}
