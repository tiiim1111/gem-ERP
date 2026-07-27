import { IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ResetPasswordDto {
  @ApiProperty({
    description:
      'New admin-set password; the user is forced to change it at next login.',
    minLength: 8,
  })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  newPassword!: string;
}
