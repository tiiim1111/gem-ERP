import { IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/** POST /scan/resolve body. */
export class ResolveCodeDto {
  @ApiProperty({
    description:
      'Raw scanned or typed code: asset tag, scan URL, SKU, alternate barcode, lot code, bin code, or manufacturer serial.',
    example: 'AST-SUB-LAP-2026-000123',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(512)
  code!: string;
}
