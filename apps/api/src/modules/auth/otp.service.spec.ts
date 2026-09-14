import { Test } from '@nestjs/testing';

import { AppConfigService } from '../../config/app-config.service';
import { PrismaService } from '../../prisma/prisma.service';
import { OtpService } from './otp.service';

describe('OtpService', () => {
  const otpChallenge = {
    findFirst: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    create: jest.fn(),
  };
  const prismaMock = {
    otpChallenge,
    $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
  };
  const configMock = {
    otp: {
      length: 6,
      ttlMinutes: 10,
      maxAttempts: 5,
      resendCooldownSeconds: 60,
      pepper: 'test-pepper',
    },
  };

  let service: OtpService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        OtpService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: AppConfigService, useValue: configMock },
      ],
    }).compile();
    service = moduleRef.get(OtpService);
  });

  describe('issue', () => {
    it('invalidates any active challenge and creates a fresh one', async () => {
      const { code, ttlMinutes } = await service.issue('user-1', 'EMAIL_VERIFICATION');

      expect(code).toMatch(/^\d{6}$/);
      expect(ttlMinutes).toBe(10);
      expect(otpChallenge.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId: 'user-1',
            consumedAt: null,
            invalidatedAt: null,
          }),
        }),
      );
      expect(otpChallenge.create).toHaveBeenCalled();
    });
  });

  describe('verify', () => {
    it('reports not_found when there is no active challenge', async () => {
      otpChallenge.findFirst.mockResolvedValue(null);
      const result = await service.verify('user-1', 'EMAIL_VERIFICATION', '123456');
      expect(result).toEqual({ outcome: 'not_found' });
    });

    it('reports expired and invalidates the challenge', async () => {
      otpChallenge.findFirst.mockResolvedValue({
        id: 'c1',
        attemptCount: 0,
        maxAttempts: 5,
        expiresAt: new Date(Date.now() - 1000),
        codeHash: 'irrelevant',
      });
      const result = await service.verify('user-1', 'EMAIL_VERIFICATION', '000000');
      expect(result).toEqual({ outcome: 'expired' });
      expect(otpChallenge.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { invalidatedAt: expect.any(Date) } }),
      );
    });

    it('reports max_attempts_exceeded once the limit is already reached', async () => {
      otpChallenge.findFirst.mockResolvedValue({
        id: 'c1',
        attemptCount: 5,
        maxAttempts: 5,
        expiresAt: new Date(Date.now() + 60_000),
        codeHash: 'irrelevant',
      });
      const result = await service.verify('user-1', 'EMAIL_VERIFICATION', '000000');
      expect(result).toEqual({ outcome: 'max_attempts_exceeded' });
    });

    it('reports invalid and increments the attempt count on a wrong code', async () => {
      otpChallenge.findFirst.mockResolvedValue({
        id: 'c1',
        attemptCount: 0,
        maxAttempts: 5,
        expiresAt: new Date(Date.now() + 60_000),
        codeHash: 'does-not-match-anything',
      });
      otpChallenge.update.mockResolvedValue({ attemptCount: 1, maxAttempts: 5 });

      const result = await service.verify('user-1', 'EMAIL_VERIFICATION', '999999');

      expect(result).toEqual({ outcome: 'invalid' });
      expect(otpChallenge.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { attemptCount: { increment: 1 } } }),
      );
    });

    it('reports max_attempts_exceeded once a wrong code exhausts the last attempt', async () => {
      otpChallenge.findFirst.mockResolvedValue({
        id: 'c1',
        attemptCount: 4,
        maxAttempts: 5,
        expiresAt: new Date(Date.now() + 60_000),
        codeHash: 'does-not-match-anything',
      });
      otpChallenge.update.mockResolvedValue({ attemptCount: 5, maxAttempts: 5 });

      const result = await service.verify('user-1', 'EMAIL_VERIFICATION', '999999');
      expect(result).toEqual({ outcome: 'max_attempts_exceeded' });
    });

    it('reports valid and consumes the challenge on a correct code', async () => {
      // Issue for real to get a matching hash, then verify with the same code.
      let stored: { codeHash: string } | undefined;
      otpChallenge.create.mockImplementation(({ data }: { data: { codeHash: string } }) => {
        stored = data;
        return Promise.resolve(data);
      });
      const { code } = await service.issue('user-1', 'EMAIL_VERIFICATION');

      otpChallenge.findFirst.mockResolvedValue({
        id: 'c1',
        attemptCount: 0,
        maxAttempts: 5,
        expiresAt: new Date(Date.now() + 60_000),
        codeHash: stored?.codeHash,
      });

      const result = await service.verify('user-1', 'EMAIL_VERIFICATION', code);

      expect(result).toEqual({ outcome: 'valid' });
      expect(otpChallenge.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { consumedAt: expect.any(Date) } }),
      );
    });
  });
});
