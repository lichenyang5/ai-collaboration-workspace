import {
  Body,
  Controller,
  Get,
  Post,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard, type CurrentUserPayload } from '../common/guards/jwt-auth.guard';
import { CreateTeamDto } from './dto/create-team.dto';
import { TeamsService } from './teams.service';

@Controller('teams')
@UseGuards(JwtAuthGuard)
export class TeamsController {
  constructor(private readonly teamsService: TeamsService) {}

  @Post()
  createTeam(
    @Body(new ValidationPipe({ whitelist: true, transform: true })) input: CreateTeamDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.teamsService.createTeam(input, user.id);
  }

  @Get()
  getTeams(@CurrentUser() user: CurrentUserPayload) {
    return this.teamsService.getTeamsForUser(user.id);
  }
}