import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { Matches } from 'class-validator';

/**
 * Normalises a phone number to E.164. A bare 9-digit number is treated as Polish (+48),
 * because the shop is a single local branch.
 */
export function normalizePhone(input: unknown): unknown {
  if (typeof input !== 'string') return input;
  let v = input.replace(/[\s\-().]/g, '');
  if (v.startsWith('00')) v = `+${v.slice(2)}`;
  if (/^\d{9}$/.test(v)) v = `+48${v}`;
  return v;
}

export const IsPhone = () =>
  applyDecorators(
    Transform(({ value }) => normalizePhone(value)),
    Matches(/^\+[1-9]\d{7,14}$/, { message: 'Enter a valid phone number, e.g. +48 600 100 200' }),
  );
