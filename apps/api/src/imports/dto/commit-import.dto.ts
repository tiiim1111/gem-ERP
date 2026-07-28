import { IsIn, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CommitImportDto {
  @ApiProperty({ description: 'Staging ID returned by /validate.' })
  @IsUUID()
  stagingId!: string;

  @ApiProperty({
    enum: ['strict', 'partial'],
    description:
      'strict = all-or-nothing; partial = valid rows only (explicit opt-in, spec §24).',
  })
  @IsIn(['strict', 'partial'])
  mode!: 'strict' | 'partial';
}
