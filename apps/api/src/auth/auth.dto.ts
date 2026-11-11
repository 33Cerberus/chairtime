import { Transform } from 'class-transformer';
import { IsEmail, IsOptional, IsString, Length, Matches, MaxLength, MinLength } from 'class-validator';
import { IsPassword } from '../common/password-policy';
import { IsPhone } from '../common/phone';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const emptyToUndefined = ({ value }: { value: unknown }) =>
  typeof value === 'string' && value.trim() === '' ? undefined : typeof value === 'string' ? value.trim().toLowerCase() : value;

export class RegisterDto {
  @Transform(trim) @IsString() @Length(1, 60)
  firstName: string;

  @Transform(trim) @IsString() @Length(1, 60)
  lastName: string;

  @IsPhone()
  phoneNumber: string;

  @IsOptional() @Transform(emptyToUndefined) @IsEmail({}, { message: 'Enter a valid e-mail address' })
  email?: string;

  @IsPassword()
  password: string;

  /** 6-digit code sent to the phone. Required only when the phone already has a record created by the shop. */
  @IsOptional() @Matches(/^\d{6}$/, { message: 'The code has 6 digits' })
  code?: string;
}

export class LoginDto {
  @IsPhone()
  phoneNumber: string;

  @IsString() @MinLength(1) @MaxLength(128)
  password: string;
}

export class RefreshDto {
  /** Only for clients that cannot use cookies (mobile). Browsers send the httpOnly cookie. */
  @IsOptional() @IsString()
  refreshToken?: string;
}

export class SetPasswordDto {
  @IsString() @MinLength(20)
  token: string;

  @IsPassword()
  password: string;
}

export class PasswordResetRequestDto {
  @IsPhone()
  phoneNumber: string;
}

export class PasswordResetDto {
  @IsPhone()
  phoneNumber: string;

  @Matches(/^\d{6}$/, { message: 'The code has 6 digits' })
  code: string;

  @IsPassword()
  password: string;
}
