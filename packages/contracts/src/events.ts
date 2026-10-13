import { z } from 'zod';

/** What every queue job carries: one outbox row, as published by the relay. */
export const eventEnvelopeSchema = z.strictObject({
  id: z.uuid(),
  type: z.string(),
  aggregateType: z.string(),
  aggregateId: z.uuid(),
  occurredAt: z.iso.datetime(),
  payload: z.record(z.string(), z.unknown()),
});

export type EventEnvelope = z.infer<typeof eventEnvelopeSchema>;
