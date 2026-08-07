import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { Repository } from 'typeorm';
import { User } from '../database/entities/user.entity';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

export interface PublicUser {
  id: string;
  email: string;
  displayName: string;
}

interface AuthenticationResult {
  user: PublicUser;
  accessToken: string;
}

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly jwtService: JwtService,
  ) {}

  async register(input: RegisterDto): Promise<AuthenticationResult> {
    const email = input.email.trim().toLowerCase();
    const existingUser = await this.userRepository.findOne({ where: { email } });

    if (existingUser) {
      throw new ConflictException('该邮箱已注册');
    }

    const passwordHash = await bcrypt.hash(input.password, 12);
    const user = this.userRepository.create({
      email,
      displayName: input.displayName.trim(),
      passwordHash,
    });
    const savedUser = await this.userRepository.save(user);

    return this.createAuthenticationResult(savedUser);
  }

  async login(input: LoginDto): Promise<AuthenticationResult> {
    const email = input.email.trim().toLowerCase();
    const user = await this.userRepository.findOne({
      where: { email },
      select: { id: true, email: true, displayName: true, passwordHash: true },
    });

    if (!user || !(await bcrypt.compare(input.password, user.passwordHash))) {
      throw new UnauthorizedException('邮箱或密码错误');
    }

    return this.createAuthenticationResult(user);
  }

  async getCurrentUser(userId: string): Promise<PublicUser> {
    const user = await this.userRepository.findOne({
      where: { id: userId },
      select: { id: true, email: true, displayName: true },
    });

    if (!user) {
      throw new UnauthorizedException('登录状态已失效');
    }

    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
    };
  }

  private async createAuthenticationResult(user: User): Promise<AuthenticationResult> {
    const publicUser: PublicUser = {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
    };
    const accessToken = await this.jwtService.signAsync({
      sub: publicUser.id,
      email: publicUser.email,
    });

    return { user: publicUser, accessToken };
  }
}