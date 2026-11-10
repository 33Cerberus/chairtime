import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class PageQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page?: number = 1;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit?: number = 20;
}

export const paging = (q: PageQuery) => {
  const page = q.page ?? 1;
  const limit = q.limit ?? 20;
  return { skip: (page - 1) * limit, take: limit };
};

export interface Page<T> {
  items: T[];
  total: number;
}
