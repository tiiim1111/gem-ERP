import { IsArray, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SetRolePermissionsDto {
  @ApiProperty({
    type: [String],
    description:
      'Complete replacement permission set, validated against the catalog.',
  })
  @IsArray()
  @IsString({ each: true })
  permissions!: string[];
}
