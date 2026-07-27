import { IsArray, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SetBranchAccessDto {
  @ApiProperty({
    type: [String],
    description: 'Complete replacement set of accessible branch IDs.',
  })
  @IsArray()
  @IsUUID(undefined, { each: true })
  branchIds!: string[];
}
