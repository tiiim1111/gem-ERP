import { IsArray, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SetUserRolesDto {
  @ApiProperty({
    type: [String],
    description: 'Complete replacement set of role IDs (may be empty).',
  })
  @IsArray()
  @IsUUID(undefined, { each: true })
  roleIds!: string[];
}
