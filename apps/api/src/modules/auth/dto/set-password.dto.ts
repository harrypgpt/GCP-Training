import { IsString, MinLength } from 'class-validator';

export class SetPasswordDto {
  @IsString()
  emailVerificationToken!: string;

  /**
   * A generous floor so obviously-too-short input is rejected before it even
   * reaches the service. The authoritative policy (configurable minimum
   * length + composition) is enforced in {@link AuthService}.
   */
  @IsString()
  @MinLength(8)
  password!: string;
}
