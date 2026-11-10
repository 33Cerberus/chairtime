import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { PageQuery } from '../common/pagination';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const toBool = ({ value }: { value: unknown }) => (value === 'true' ? true : value === 'false' ? false : value);

// ---- Services ---------------------------------------------------------------------------------

export class CreateServiceDto {
  @Transform(trim) @IsString() @Length(1, 80)
  name: string;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(500)
  description?: string;

  /** Minutes. Must be a multiple of 15. */
  @IsInt() @Min(15) @Max(480)
  duration: number;
}

export class UpdateServiceDto {
  @IsOptional() @Transform(trim) @IsString() @Length(1, 80)
  name?: string;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(500)
  description?: string;

  @IsOptional() @IsInt() @Min(15) @Max(480)
  duration?: number;

  @IsOptional() @IsBoolean()
  isActive?: boolean;
}

// ---- Barbers ----------------------------------------------------------------------------------

export class UpdateBarberDto {
  @IsOptional() @Transform(trim) @IsString() @MaxLength(1000)
  bio?: string;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(80)
  title?: string;

  /** Pass null to remove the photo. To set one, upload it with POST /barbers/:id/photo. */
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(500)
  photoUrl?: string | null;
}

export class AssignServiceDto {
  @IsUUID()
  serviceId: string;

  /** Grosze. */
  @IsInt() @Min(0) @Max(10_000_00)
  price: number;
}

export class UpdatePriceDto {
  @IsInt() @Min(0) @Max(10_000_00)
  price: number;
}

// ---- Products ---------------------------------------------------------------------------------

export class CreateProductDto {
  @Transform(trim) @IsString() @Length(1, 100)
  name: string;

  @Transform(trim) @IsString() @Length(1, 2000)
  description: string;

  /** Grosze. */
  @IsInt() @Min(0) @Max(10_000_00)
  price: number;

  @IsInt() @Min(0) @Max(100_000)
  stock: number;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(40)
  category?: string;
}

export class UpdateProductDto {
  @IsOptional() @Transform(trim) @IsString() @Length(1, 100)
  name?: string;

  @IsOptional() @Transform(trim) @IsString() @Length(1, 2000)
  description?: string;

  @IsOptional() @IsInt() @Min(0) @Max(10_000_00)
  price?: number;

  @IsOptional() @IsInt() @Min(0) @Max(100_000)
  stock?: number;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(40)
  category?: string;

  @IsOptional() @IsBoolean()
  isActive?: boolean;

  /** Reorder or remove photos. Only URLs the product already has are accepted. */
  @IsOptional() @IsString({ each: true })
  photoUrls?: string[];
}

export class ProductsQuery extends PageQuery {
  @IsOptional() @Transform(trim) @IsString() @MaxLength(80)
  search?: string;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(40)
  category?: string;

  /** Administrators only: include deactivated products. Defaults to true for them. */
  @IsOptional() @Transform(toBool) @IsBoolean()
  includeInactive?: boolean;
}

export class CartItemDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(99)
  quantity: number;
}
