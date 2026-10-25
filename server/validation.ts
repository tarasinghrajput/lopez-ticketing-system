import { z } from 'zod';
import { DateTime } from 'luxon';
const text = (max = 100) => z.string().trim().min(1).max(max);
export const bookingInput = z.object({
  tableId: text(),
  partySize: z.number().int().min(1).max(30),
  start: z.iso.datetime({ offset: true }),
  notes: z.string().trim().max(500).optional(),
});
export const walkInInput = bookingInput.extend({
  guestName: text(),
  email: z.email().optional(),
  phone: z.string().trim().max(30).optional(),
});
export const tableInput = z.object({
  number: text(10),
  capacity: z.number().int().min(1).max(30),
  area: text(60),
  active: z.boolean(),
  order: z.number().int().min(0).max(999),
});
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const settingsInput = z
  .object({
    name: text(80),
    timezone: z
      .string()
      .refine((v) => DateTime.now().setZone(v).isValid, 'Use a valid IANA timezone.'),
    durationMinutes: z.number().int().min(15).max(300),
    slotMinutes: z.number().int().min(5).max(60),
    depositPaise: z.number().int().min(100).max(10000000),
    horizonDays: z.number().int().min(1).max(365),
    graceMinutes: z.number().int().min(0).max(120),
    hours: z
      .array(
        z.object({
          day: z.number().int().min(0).max(6),
          open: time,
          close: time,
          closed: z.boolean(),
        }),
      )
      .length(7),
    closedDates: z
      .array(
        z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .refine((v) => DateTime.fromISO(v).isValid),
      )
      .max(366),
  })
  .superRefine((v, ctx) => {
    if (new Set(v.hours.map((h) => h.day)).size !== 7)
      ctx.addIssue({ code: 'custom', message: 'Provide each weekday exactly once.' });
    for (const h of v.hours)
      if (
        !h.closed &&
        (h.open >= h.close ||
          Number(h.close.slice(0, 2)) * 60 +
            Number(h.close.slice(3)) -
            (Number(h.open.slice(0, 2)) * 60 + Number(h.open.slice(3))) <
            v.durationMinutes)
      )
        ctx.addIssue({
          code: 'custom',
          message: 'Opening hours must fit a complete visit and end the same day.',
        });
  });
