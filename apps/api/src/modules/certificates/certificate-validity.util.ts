/**
 * Adds a whole number of calendar months to a date, clamping the day to the
 * last valid day of the target month (e.g. Jan 31 + 1 month = Feb 28, never
 * "Mar 3" the way naive `Date#setMonth` arithmetic would silently roll
 * over). Operates on UTC calendar components only, since Certificate's
 * `issueDate`/`expiryDate` columns are `@db.Date` (calendar dates, no time
 * component) - this is deliberately NOT `365 * 24` hours of drift, which
 * would not correctly express "12 months" across leap years.
 */
export function addCalendarMonths(date: Date, months: number): Date {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = date.getUTCDate();

  const targetMonthIndex = month + months;
  const targetYear = year + Math.floor(targetMonthIndex / 12);
  const targetMonth = ((targetMonthIndex % 12) + 12) % 12;

  const daysInTargetMonth = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const clampedDay = Math.min(day, daysInTargetMonth);

  return new Date(Date.UTC(targetYear, targetMonth, clampedDay));
}
