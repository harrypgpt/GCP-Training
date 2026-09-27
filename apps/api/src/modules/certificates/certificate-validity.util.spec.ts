import { addCalendarMonths } from './certificate-validity.util';

describe('addCalendarMonths', () => {
  it('adds 12 months across a year boundary, matching the default validity period', () => {
    const result = addCalendarMonths(new Date(Date.UTC(2026, 8, 18)), 12); // 2026-09-18
    expect(result.toISOString().slice(0, 10)).toBe('2027-09-18');
  });

  it('clamps Jan 31 + 1 month to the last day of February in a non-leap year', () => {
    const result = addCalendarMonths(new Date(Date.UTC(2025, 0, 31)), 1); // 2025-01-31
    expect(result.toISOString().slice(0, 10)).toBe('2025-02-28');
  });

  it('clamps Jan 31 + 1 month to Feb 29 in a leap year', () => {
    const result = addCalendarMonths(new Date(Date.UTC(2028, 0, 31)), 1); // 2028 is a leap year
    expect(result.toISOString().slice(0, 10)).toBe('2028-02-29');
  });

  it('rolls over the year when adding past December', () => {
    const result = addCalendarMonths(new Date(Date.UTC(2026, 11, 15)), 3); // 2026-12-15
    expect(result.toISOString().slice(0, 10)).toBe('2027-03-15');
  });

  it('handles a validity period longer than 12 months', () => {
    const result = addCalendarMonths(new Date(Date.UTC(2026, 0, 1)), 24);
    expect(result.toISOString().slice(0, 10)).toBe('2028-01-01');
  });

  it('is not equivalent to a fixed 365-day offset (proves calendar arithmetic, not hour math)', () => {
    // 2028 is a leap year, so 12 calendar months from 2027-03-01 spans 366
    // days - a naive "365 * 24 hours" implementation would land one day early.
    const start = new Date(Date.UTC(2027, 2, 1)); // 2027-03-01
    const byMonths = addCalendarMonths(start, 12);
    const byFixedDays = new Date(start.getTime() + 365 * 24 * 60 * 60 * 1000);
    expect(byMonths.toISOString().slice(0, 10)).toBe('2028-03-01');
    expect(byFixedDays.toISOString().slice(0, 10)).not.toBe('2028-03-01');
  });
});
