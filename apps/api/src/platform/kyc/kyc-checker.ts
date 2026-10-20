import { Injectable } from '@nestjs/common';

/**
 * Automated KYC check run while a worker is KYC_PENDING (decision WORKER-1). Decision KYC-3: until
 * a licensed provider is chosen, the fake passes everything and admins review the documents by
 * hand. A real provider (Aadhaar verification, face match) implements this interface.
 */
export interface KycChecker {
  check(input: { userId: string; aadhaarFrontMediaId: string; selfieMediaId: string }): Promise<{
    outcome: 'passed' | 'failed';
    note: string;
  }>;
}

export const KYC_CHECKER = Symbol('KYC_CHECKER');

@Injectable()
export class FakeKycChecker implements KycChecker {
  check(): Promise<{ outcome: 'passed'; note: string }> {
    return Promise.resolve({ outcome: 'passed', note: 'no automated provider yet (KYC-3)' });
  }
}
