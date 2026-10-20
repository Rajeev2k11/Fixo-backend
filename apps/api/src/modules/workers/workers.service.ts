import {
  ErrorCode,
  type UpdateWorkerProfile,
  type WorkerProfile,
  onboardingItemSchema,
} from '@fixo/contracts';
import { Injectable } from '@nestjs/common';

import { AppError } from '../../common/app-error.js';
import { ConfigService } from '../config/config.service.js';
import { GeoService } from '../geo/geo.service.js';
import { MediaService } from '../media/media.service.js';
import { WorkerProfileService } from '../users/worker-profile.service.js';
import { WORKER_AGREEMENT_VERSION } from './workers.config.js';

type OnboardingItem = (typeof onboardingItemSchema.options)[number];

/** Worker onboarding as the worker app sees it (spec §C steps 1-2 and 6; KYC in step 2.3). */
@Injectable()
export class WorkersService {
  constructor(
    private readonly workers: WorkerProfileService,
    private readonly media: MediaService,
    private readonly geo: GeoService,
    private readonly config: ConfigService,
  ) {}

  async me(userId: string): Promise<WorkerProfile> {
    const [{ profile, cityId, agreement }, currentVersion] = await Promise.all([
      this.workers.get(userId),
      this.currentAgreementVersion(),
    ]);
    const missing: OnboardingItem[] = [];
    if (!profile.name) missing.push('name');
    if (!profile.photoMediaId) missing.push('photo');
    if (!cityId) missing.push('city');
    if (!currentVersion || agreement?.version !== currentVersion) missing.push('agreement');

    return {
      userId,
      status: profile.status,
      statusReason: profile.statusReason,
      name: profile.name,
      photo: profile.photoMediaId
        ? { mediaId: profile.photoMediaId, url: await this.media.linkFor(profile.photoMediaId) }
        : null,
      cityId,
      agreement: {
        acceptedVersion: agreement?.version ?? null,
        acceptedAt: agreement?.acceptedAt.toISOString() ?? null,
        currentVersion,
      },
      missing,
    };
  }

  async update(userId: string, input: UpdateWorkerProfile): Promise<WorkerProfile> {
    if (input.photoMediaId) {
      await this.media.assertUsable(userId, input.photoMediaId, 'profile_photo');
    }
    if (input.cityId && !(await this.geo.findActiveCity(input.cityId))) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, 400, 'FIXO does not serve this city yet', {
        cityId: input.cityId,
      });
    }
    await this.workers.updateProfile(userId, input);
    return this.me(userId);
  }

  /** Accepting means accepting the text the app showed: only the current version is accepted. */
  async acceptAgreement(userId: string, version: string): Promise<WorkerProfile> {
    const current = await this.currentAgreementVersion();
    if (!current) {
      throw new AppError(
        ErrorCode.AGREEMENT_NOT_PUBLISHED,
        503,
        'The worker agreement is not published yet',
      );
    }
    if (version !== current) {
      throw new AppError(ErrorCode.AGREEMENT_OUTDATED, 409, 'A newer agreement exists; review it', {
        currentVersion: current,
      });
    }
    await this.workers.recordAgreement(userId, version);
    return this.me(userId);
  }

  private async currentAgreementVersion(): Promise<string | null> {
    try {
      return (await this.config.resolve(WORKER_AGREEMENT_VERSION)).value;
    } catch (err) {
      if (err instanceof AppError && err.code === ErrorCode.CONFIG_NOT_SET) return null;
      throw err;
    }
  }
}
