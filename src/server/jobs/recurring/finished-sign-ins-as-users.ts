/**
 * @file The job that ends staff sign-ins as a user whose time is up or whose
 * staff session is gone, recording each (`endFinishedImpersonations`). A
 * request that finds one over ends it too; this catches those nobody came
 * back to. It runs on every tick.
 */
import { endFinishedImpersonations } from '../../auth/impersonation';
import { defineRecurringJob } from '../define';

export default defineRecurringJob({
  name: 'finished-sign-ins-as-users',
  schedule: '*/5 * * * *',
  // A sign-in as a user must end when its time is up.
  pausable: false,
  /**
   * Ends them.
   *
   * @param ctx - Service context.
   * @returns How many were ended.
   */
  run: async (ctx) => ({ summary: { ended: await endFinishedImpersonations(ctx) } }),
});
