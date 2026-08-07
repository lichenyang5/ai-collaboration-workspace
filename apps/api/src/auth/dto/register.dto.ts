import { IsEmail, IsString, Length, MaxLength } from 'class-validator';

export class RegisterDto {
  @IsEmail()
  email!: string;

  @IsString()
  @Length(2, 100)
  displayName!: string;

  @IsString()
  @Length(8, 72)
  password!: string;
}