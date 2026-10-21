import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';

export class OAuthExchangeDto {
  @ApiProperty({
    description: 'Short-lived, single-use code returned by the OAuth callback',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  code: string;

  @ApiProperty({
    description: 'Browser-held verifier created when the sign-in was started',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^[A-Za-z0-9_-]{43,128}$/)
  code_verifier: string;
}
