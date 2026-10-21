import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval("deletion jobs", { minutes: 5 }, internal.maintenance.runDeletionJobs, {});
crons.interval("task reminders", { minutes: 1 }, internal.tasks.processReminders, {});
crons.interval("presence cleanup", { minutes: 10 }, internal.presence.cleanup, {});
crons.interval("ai stream cleanup", { minutes: 60 }, internal.ai.sweepStreams, {});
crons.interval("ai chat cleanup", { minutes: 60 }, internal.aiChat.sweep, {});
crons.interval("ai research cleanup", { minutes: 30 }, internal.aiResearch.sweep, {});
crons.interval("ai digests", { minutes: 15 }, internal.aiDigest.due, {});
crons.interval("ai routines", { minutes: 15 }, internal.routines.due, {});
crons.interval("expired plans", { minutes: 60 }, internal.billing.settleExpiredPlans, {});
crons.interval("calendar subscriptions", { minutes: 30 }, internal.externalCalendars.refreshDue, {});
crons.interval("api idempotency cleanup", { minutes: 60 }, internal.restApi.sweep, {});
crons.interval("proposal expiry", { minutes: 60 }, internal.proposals.sweep, {});
crons.interval("e2ee approval expiry", { minutes: 5 }, internal.e2ee.devices.expireRequests, {});
crons.interval("e2ee reminders", { minutes: 1 }, internal.e2ee.reminders.process, {});
crons.daily("webhook delivery cleanup", { hourUTC: 4, minuteUTC: 50 }, internal.webhooks.sweep, {});
crons.daily("trash retention", { hourUTC: 3, minuteUTC: 0 }, internal.maintenance.purgeExpiredTrash, {});
crons.daily("tombstone retention", { hourUTC: 3, minuteUTC: 20 }, internal.maintenance.purgeTombstones, {});
crons.daily("housekeeping", { hourUTC: 3, minuteUTC: 40 }, internal.maintenance.housekeeping, {});
crons.daily("snapshot retention", { hourUTC: 4, minuteUTC: 0 }, internal.documents.purgeSnapshots, {});
crons.daily("comment digest", { hourUTC: 8, minuteUTC: 0 }, internal.digest.sendDailyDigests, {});
crons.daily("orphaned upload cleanup", { hourUTC: 4, minuteUTC: 30 }, internal.files.sweepOrphanedStorage, {});
crons.daily("export retention", { hourUTC: 4, minuteUTC: 45 }, internal.files.purgeExpiredExports, {});
crons.daily("daily metrics", { hourUTC: 0, minuteUTC: 15 }, internal.maintenance.dailyMetrics, {});
crons.daily("ai index sweep", { hourUTC: 5, minuteUTC: 0 }, internal.aiIndex.sweep, {});
crons.daily("ai graph sweep", { hourUTC: 5, minuteUTC: 30 }, internal.aiGraph.sweep, {});
crons.daily("e2ee superseded key cleanup", { hourUTC: 5, minuteUTC: 45 }, internal.e2ee.keys.sweep, {});
crons.daily("e2ee inbox expiry", { hourUTC: 5, minuteUTC: 50 }, internal.e2ee.inbox.expire, {});

export default crons;
