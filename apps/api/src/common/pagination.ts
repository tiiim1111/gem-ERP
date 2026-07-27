import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  Paginated,
  PaginationMeta,
} from '@gemerp/shared';
import { AppException } from './errors/app.exception';

/** Canonical pagination query params: page (1-based), pageSize (max 100), sort. */
export class PaginationQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: DEFAULT_PAGE_SIZE, maximum: MAX_PAGE_SIZE })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  pageSize?: number = DEFAULT_PAGE_SIZE;

  @ApiPropertyOptional({
    description: 'Sort spec "field:asc" or "field:desc".',
    example: 'createdAt:desc',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  sort?: string;
}

export interface PageArgs {
  page: number;
  pageSize: number;
  skip: number;
  take: number;
}

export function pageArgs(query: PaginationQueryDto): PageArgs {
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}

export function buildMeta(
  page: number,
  pageSize: number,
  total: number,
): PaginationMeta {
  return {
    page,
    pageSize,
    total,
    totalPages: Math.ceil(total / pageSize),
  };
}

export function paginated<T>(
  data: T[],
  page: number,
  pageSize: number,
  total: number,
): Paginated<T> {
  return { data, meta: buildMeta(page, pageSize, total) };
}

export type SortDirection = 'asc' | 'desc';

/**
 * Parse a `field:asc|desc` sort param against an allowlist mapping public
 * field names to Prisma column names. Unknown fields or malformed specs are
 * rejected with a VALIDATION_ERROR (never passed into a query).
 */
export function parseSort(
  sort: string | undefined,
  allowed: Record<string, string>,
  fallback: { field: string; direction: SortDirection },
): Record<string, SortDirection> {
  if (!sort) {
    return { [allowed[fallback.field] ?? fallback.field]: fallback.direction };
  }
  const [field, rawDirection = 'asc'] = sort.split(':');
  const direction = rawDirection.toLowerCase();
  const column = allowed[field];
  if (!column || (direction !== 'asc' && direction !== 'desc')) {
    throw AppException.validation([
      {
        field: 'sort',
        message: `sort must be one of [${Object.keys(allowed).join(', ')}] followed by ":asc" or ":desc"`,
      },
    ]);
  }
  return { [column]: direction };
}
