import { IsEmail, Matches } from 'class-validator';

export class VerifyEmailDto {
  @IsEmail()
  email!: string;

  @Matches(/^\d{4,10}$/, { message: 'code must be 4-10 digits' })
  code!: string;
}
