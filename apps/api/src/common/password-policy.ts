import { applyDecorators } from '@nestjs/common';
import { IsString, MaxLength, MinLength, registerDecorator, ValidationOptions } from 'class-validator';

/** The passwords attackers try first. Length alone does not rule these out. */
const COMMON = new Set([
  'password', 'password1', 'password12', 'password123', 'passw0rd', 'p@ssw0rd', 'qwertyui', 'qwertyuiop',
  'qwerty123', 'qwerty1234', '1q2w3e4r', '1q2w3e4r5t', '1qaz2wsx', 'zaq12wsx', 'asdfghjk', 'asdfghjkl',
  'iloveyou', 'iloveyou1', 'letmein1', 'welcome1', 'welcome123', 'admin123', 'administrator', 'abc12345',
  'abcd1234', 'changeme', 'changeme1', 'sunshine', 'princess', 'football', 'baseball', 'superman',
  'trustno1', 'starwars', 'whatever', 'computer', 'internet', 'chairtime', 'chairtime1', 'chairtime123',
  'barbershop', 'barber123', 'polska123', 'haslo123', 'zaq1@wsx',
]);

export function weakPasswordReason(value: unknown): string | null {
  if (typeof value !== 'string') return 'Enter a password';
  const lower = value.toLowerCase();
  if (COMMON.has(lower)) return 'This password is too common. Choose something harder to guess';
  if (/^\d+$/.test(value)) return 'A password made only of digits is too easy to guess';
  if (/^(.)\1+$/.test(value)) return 'A password cannot be one character repeated';
  return null;
}

function NotWeak(options?: ValidationOptions) {
  return (object: object, propertyName: string | symbol) =>
    registerDecorator({
      name: 'notWeakPassword',
      target: object.constructor,
      propertyName: String(propertyName),
      options,
      validator: {
        validate: (value: unknown) => weakPasswordReason(value) === null,
        defaultMessage: (args) => weakPasswordReason(args?.value) ?? 'Choose a stronger password',
      },
    });
}

/** At least 8 characters, and not one of the passwords everybody tries first. */
export const IsPassword = () =>
  applyDecorators(
    IsString(),
    MinLength(8, { message: 'Password must be at least 8 characters' }),
    MaxLength(128),
    NotWeak(),
  );
