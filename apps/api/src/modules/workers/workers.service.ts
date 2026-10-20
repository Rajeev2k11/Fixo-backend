import {
  type Availability,
  ErrorCode,
  type WorkerOnboarding,
  type WorkerProfile,
} from '@fixo/contracts';
import { Inject, Injectable } from '@nestjs/common';

import { AppError } from '../../common/app-error.js';
import { DB, type Db } from '../../common/db.js';
import { CatalogueService } from '../catalogue/catalogue.service.js';
import { ConfigService } from '../config/config.service.js';
import { GeoService } from '../geo/geo.service.js';
import { MediaService } from '../media/media.service.js';
import { WorkerProfileService } from '../users/worker-profile.service.js';
import { WorkersRepository } from './workers.repository.js';
import { WORKER_AGREEMENT_VERSION } from './workers.config.js';

interface Problem {
  path: string;
  message: string;
}

/** Worker onboarding as the Partner app sees it: one submission carrying every step. */
@Injectable()
export class WorkersService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly repo: WorkersRepository,
    private readonly workers: WorkerProfileService,
    private readonly media: MediaService,
    private readonly geo: GeoService,
    private readonly catalogue: CatalogueService,
    private readonly config: ConfigService,
  ) {}

  async me(userId: string): Promise<WorkerProfile> {
    const [{ profile, cityId, agreement }, capabilities, currentVersion] = await Promise.all([
      this.workers.get(userId),
      this.repo.find(this.db, userId),
      this.currentAgreementVersion(),
    ]);
    const p = capabilities.preference;
    return {
      userId,
      status: profile.status,
      statusReason: profile.statusReason,
      submittedAt: profile.submittedAt?.toISOString() ?? null,
      agreement: { acceptedVersion: agreement?.version ?? null, currentVersion },
      onboarding: {
        name: profile.name,
        photo: profile.photoMediaId
          ? { mediaId: profile.photoMediaId, url: await this.media.linkFor(profile.photoMediaId) }
          : null,
        cityId,
        wholeCity: p?.wholeCity ?? false,
        areaIds: capabilities.areaIds,
        categoryIds: capabilities.categoryIds,
        experienceYears: profile.experienceYears,
        about: profile.about,
        availability: p
          ? {
              // Stored only from input validated by availabilitySchema.
              days: p.days as Availability['days'],
              allDay: p.allDay,
              startTime: p.startTime,
              endTime: p.endTime,
              emergency: p.emergency,
            }
          : null,
        kycSubmitted: capabilities.kycSubmitted,
      },
    };
  }

  /**
   * Final onboarding submission. Checks everything (reporting all problems at once, so the app
   * can send the worker to the right step), then saves it and moves the worker to KYC_PENDING
   * in one transaction: all of it is stored, or none of it.
   */
  async submit(userId: string, input: WorkerOnboarding): Promise<WorkerProfile> {
    await this.validate(userId, input);
    await this.db.transaction(async (tx) => {
      await this.workers.applyOnboarding(tx, userId, {
        name: input.name,
        photoMediaId: input.photoMediaId,
        cityId: input.cityId,
        experienceYears: input.experienceYears,
        about: input.about?.length ? input.about : null,
        agreementVersion: input.agreementVersion,
      });
      await this.repo.replace(tx, userId, {
        cityId: input.cityId,
        wholeCity: input.wholeCity,
        areaIds: input.wholeCity ? [] : input.areaIds,
        categoryIds: input.categoryIds,
        availability: input.availability,
        kyc: input.kyc,
      });
      await this.workers.transition(
        {
          userId,
          to: 'kyc_pending',
          actor: { userId, role: 'worker' },
          reason: 'onboarding submitted',
        },
        tx,
      );
    });
    return this.me(userId);
  }

  private async validate(userId: string, input: WorkerOnboarding): Promise<void> {
    const current = await this.currentAgreementVersion();
    if (!current) {
      throw new AppError(
        ErrorCode.AGREEMENT_NOT_PUBLISHED,
        503,
        'The worker agreement is not published yet',
      );
    }
    if (input.agreementVersion !== current) {
      throw new AppError(ErrorCode.AGREEMENT_OUTDATED, 409, 'A newer agreement exists; review it', {
        currentVersion: current,
      });
    }

    const files: [string, string, Parameters<MediaService['isUsable']>[2]][] = [
      ['photoMediaId', input.photoMediaId, 'profile_photo'],
      ['kyc.aadhaarFrontMediaId', input.kyc.aadhaarFrontMediaId, 'aadhaar_front'],
      ['kyc.aadhaarBackMediaId', input.kyc.aadhaarBackMediaId, 'aadhaar_back'],
      ['kyc.selfieMediaId', input.kyc.selfieMediaId, 'kyc_selfie'],
    ];
    const [usable, city, badAreas, badCategories] = await Promise.all([
      Promise.all(files.map(([, id, purpose]) => this.media.isUsable(userId, id, purpose))),
      this.geo.findActiveCity(input.cityId),
      input.wholeCity ? Promise.resolve([]) : this.geo.invalidAreaIds(input.cityId, input.areaIds),
      this.catalogue.invalidCategoryIds(input.categoryIds),
    ]);

    const problems: Problem[] = [];
    files.forEach(([path, , purpose], i) => {
      if (!usable[i]) problems.push({ path, message: `Upload a ${purpose} first and use its id` });
    });
    if (!city) problems.push({ path: 'cityId', message: 'FIXO does not serve this city yet' });
    else if (badAreas.length > 0) {
      problems.push({ path: 'areaIds', message: `Not areas of this city: ${badAreas.join(', ')}` });
    }
    if (badCategories.length > 0) {
      problems.push({
        path: 'categoryIds',
        message: `Unknown services: ${badCategories.join(', ')}`,
      });
    }
    if (problems.length > 0) {
      throw new AppError(
        ErrorCode.VALIDATION_FAILED,
        400,
        'Some onboarding details need fixing',
        problems,
      );
    }
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
