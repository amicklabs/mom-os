import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.daily("purge old events", { hourUTC: 9, minuteUTC: 0 }, internal.cleanup.purgeEvents, {});
crons.daily("purge old help screenshots", { hourUTC: 9, minuteUTC: 10 }, internal.cleanup.purgeHelpScreenshots, {});
crons.daily("purge old actions", { hourUTC: 9, minuteUTC: 20 }, internal.cleanup.purgeActions, {});
crons.interval("release expired job leases", { minutes: 1 }, internal.cleanup.releaseExpiredLeases, {});
// Does nothing except on Sunday 18:00-18:59 in REPORT_TIMEZONE. See reports.ts.
crons.hourly("weekly reports", { minuteUTC: 2 }, internal.reports.generateDue, {});
crons.daily("purge old device gaps", { hourUTC: 9, minuteUTC: 30 }, internal.reports.purgeGaps, {});

export default crons;
