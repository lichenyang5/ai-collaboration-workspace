import { IsEmail, MaxLength } from 'class-validator';

export class AddTeamMemberDto {
  @IsEmail()
  @MaxLength(255)
  email!: string;
}
