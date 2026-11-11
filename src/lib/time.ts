import { formatInTimeZone } from "date-fns-tz";
import { differenceInMinutes, formatDistanceToNowStrict, parseISO } from "date-fns";

/** Business timezone. Updated from settings once they load. */
let TZ = "Asia/Kuala_Lumpur";
export const setTimezone = (tz: string) => {
  TZ = tz;
};
export const timezone = () => TZ;

const toDate = (d: string | Date) => (typeof d === "string" ? parseISO(d) : d);

/** Today's date (yyyy-MM-dd) in Malaysia time. */
export const todayLocal = () => formatInTimeZone(new Date(), TZ, "yyyy-MM-dd");

export const fmtTime = (d: string | Date | null | undefined) =>
  d ? formatInTimeZone(toDate(d), TZ, "h:mm a") : "—";

export const fmtDateTime = (d: string | Date) => formatInTimeZone(toDate(d), TZ, "d MMM, h:mm a");

/** Formats a plain date (yyyy-MM-dd) without any timezone shifting. */
export const fmtDate = (ymd: string | null | undefined, pattern = "d MMM yyyy") => {
  if (!ymd) return "—";
  const [y, m, d] = ymd.split("-").map(Number);
  return formatInTimeZone(new Date(Date.UTC(y, m - 1, d, 12)), "UTC", pattern);
};

export const ago = (d: string | null | undefined) =>
  d ? `${formatDistanceToNowStrict(toDate(d))} ago` : "never";

/** "09:00:00" → "9:00 AM" */
export const fmtClock = (t: string | null | undefined) => {
  if (!t) return "—";
  const [h, m] = t.split(":").map(Number);
  const ap = h >= 12 ? "PM" : "AM";
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${ap}`;
};

/** Worked minutes for an attendance record (excluding lunch). Open records count to now. */
export function workedMinutes(a: {
  clock_in_at: string;
  clock_out_at: string | null;
  lunch_start_at: string | null;
  lunch_end_at: string | null;
}) {
  const end = a.clock_out_at ? parseISO(a.clock_out_at) : new Date();
  let mins = differenceInMinutes(end, parseISO(a.clock_in_at));
  if (a.lunch_start_at) {
    const lEnd = a.lunch_end_at ? parseISO(a.lunch_end_at) : end;
    mins -= differenceInMinutes(lEnd, parseISO(a.lunch_start_at));
  }
  return Math.max(0, mins);
}

export const fmtDuration = (mins: number) => `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, "0")}m`;

/** Adds days to a yyyy-MM-dd string. */
export function addDaysYmd(ymd: string, days: number) {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

export const isOverdue = (t: { due_date: string | null; status: string }) =>
  !!t.due_date && t.status !== "done" && t.due_date < todayLocal();
