import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';

import { AppConfigService } from '../../config/app-config.service';

/** Requires at least one letter and one digit, on top of a minimum length. */
const HAS_LETTER = /[A-Za-z]/;
const HAS_DIGIT = /\d/;

@Injectable()
export class PasswordService {
  constructor(private readonly config: AppConfigService) {}

  /** Returns a human-readable reason the password is rejected, or null if it's fine. */
  validateStrength(password: string): string | null {
    const { passwordMinLength } = this.config.auth;
    if (password.length < passwordMinLength) {
      return `Password must be at least ${passwordMinLength} characters long.`;
    }
    if (!HAS_LETTER.test(password) || !HAS_DIGIT.test(password)) {
      return 'Password must contain at least one letter and one number.';
    }
    return null;
  }

  hash(password: string): Promise<string> {
    return argon2.hash(password, { type: argon2.argon2id });
  }

  verify(hash: string, password: string): Promise<boolean> {
    return argon2.verify(hash, password);
  }
}
