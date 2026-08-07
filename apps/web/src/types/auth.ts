export interface PublicUser {
  id: string;
  email: string;
  displayName: string;
}

export interface AuthenticationResponse {
  user: PublicUser;
}

export interface LoginInput {
  email: string;
  password: string;
}