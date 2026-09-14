import { Test } from '@nestjs/testing';

import { AppConfigService } from '../../config/app-config.service';
import { PasswordService } from './password.service';

describe('PasswordService', () => {
  let service: PasswordService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        PasswordService,
        { provide: AppConfigService, useValue: { auth: { passwordMinLength: 12 } } },
      ],
    }).compile();
    service = moduleRef.get(PasswordService);
  });

  describe('validateStrength', () => {
    it('accepts a password meeting length and composition rules', () => {
      expect(service.validateStrength('correcthorse9battery')).toBeNull();
    });

    it('rejects a password shorter than the configured minimum', () => {
      expect(service.validateStrength('short1')).toMatch(/at least 12 characters/);
    });

    it('rejects a password with no digit', () => {
      expect(service.validateStrength('onlylettershere')).toMatch(/letter and one number/);
    });

    it('rejects a password with no letter', () => {
      expect(service.validateStrength('123456789012')).toMatch(/letter and one number/);
    });
  });

  describe('hash / verify', () => {
    it('produces a hash that verifies against the original password', async () => {
      const hash = await service.hash('correcthorse9battery');
      expect(hash).not.toBe('correcthorse9battery');
      await expect(service.verify(hash, 'correcthorse9battery')).resolves.toBe(true);
    });

    it('rejects an incorrect password against the hash', async () => {
      const hash = await service.hash('correcthorse9battery');
      await expect(service.verify(hash, 'wrong-password-1')).resolves.toBe(false);
    });
  });
});
