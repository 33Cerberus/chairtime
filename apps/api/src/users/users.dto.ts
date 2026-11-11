import { Role } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { PageQuery } from '../common/pagination';
import { IsPassword } from '../common/password-policy';
import { IsPhone } from '../common/phone';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const email = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? (value.trim() === '' ? null : value.trim().toLowerCase()) : value;

export class UpdateUserDto {
  @IsOptional() @Transform(trim) @IsString() @Length(1, 60)
  firstName?: string;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(60)
  lastName?: string;

  @IsOptional() @IsPhone()
  phoneNumber?: string;

  /** Pass null or an empty string to remove the e-mail. */
  @IsOptional() @Transform(email) @ValidateIf((_, v) => v !== null) @IsEmail({}, { message: 'Enter a valid e-mail address' })
  email?: string | null;
}

export class UpdateMeDto extends UpdateUserDto {
  @IsOptional() @IsPassword()
  password?: string;

  /** Required together with `password`. */
  @IsOptional() @IsString() @MaxLength(128)
  currentPassword?: string;
}

export class CreateClientDto {
  @Transform(trim) @IsString() @Length(1, 60)
  firstName: string;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(60)
  lastName?: string;

  @IsPhone()
  phoneNumber: string;
}

export class CreateStaffDto {
  @Transform(trim) @IsString() @Length(1, 60)
  firstName: string;

  @Transform(trim) @IsString() @Length(1, 60)
  lastName: string;

  @IsPhone()
  phoneNumber: string;

  @IsOptional() @Transform(email) @ValidateIf((_, v) => v !== null) @IsEmail({}, { message: 'Enter a valid e-mail address' })
  email?: string | null;

  @IsIn([Role.BARBER, Role.ADMIN], { message: 'role must be BARBER or ADMIN' })
  role: Role;
}

export class ChangeRoleDto {
  @IsIn([Role.CLIENT, Role.BARBER, Role.ADMIN], { message: 'role must be CLIENT, BARBER or ADMIN' })
  role: Role;
}

export class UsersQuery extends PageQuery {
  @IsOptional() @IsEnum(Role)
  role?: Role;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(80)
  search?: string;

  @IsOptional() @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value)) @IsBoolean()
  isActive?: boolean;
}
