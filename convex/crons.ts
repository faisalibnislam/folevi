import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval("deletion jobs", { minutes: 5 }, internal.maintenance.runDeletionJobs, {});
crons.interval("task reminders", { minutes: 1 }, internal.tasks.processReminders, {});
crons.interval("presence cleanup", { minutes: 10 }, internal.presence.cleanup, {});
crons.interval("ai stream cleanup", { minutes: 60 }, internal.ai.sweepStreams, {});
crons.interval("ai chat cleanup", { minutes: 60 }, internal.aiChat.sweep, {});
crons.interval("expired plans", { minutes: 60 }, internal.billing.settleExpiredPlans, {});
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

export default crons;
