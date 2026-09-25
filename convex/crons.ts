import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval("deletion jobs", { minutes: 5 }, internal.maintenance.runDeletionJobs, {});
crons.interval("task reminders", { minutes: 1 }, internal.tasks.processReminders, {});
crons.interval("presence cleanup", { minutes: 10 }, internal.presence.cleanup, {});
crons.daily("trash retention", { hourUTC: 3, minuteUTC: 0 }, internal.maintenance.purgeExpiredTrash, {});
crons.daily("tombstone retention", { hourUTC: 3, minuteUTC: 20 }, internal.maintenance.purgeTombstones, {});
crons.daily("housekeeping", { hourUTC: 3, minuteUTC: 40 }, internal.maintenance.housekeeping, {});
crons.daily("snapshot retention", { hourUTC: 4, minuteUTC: 0 }, internal.documents.purgeSnapshots, {});
crons.daily("comment digest", { hourUTC: 8, minuteUTC: 0 }, internal.digest.sendDailyDigests, {});
crons.daily("daily metrics", { hourUTC: 0, minuteUTC: 15 }, internal.maintenance.dailyMetrics, {});

export default crons;
