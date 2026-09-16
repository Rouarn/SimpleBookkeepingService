import { IsIn, IsOptional } from 'class-validator';

export class UploadSceneDto {
  @IsOptional()
  @IsIn(['bill', 'avatar'], { message: 'scene 仅支持 bill / avatar' })
  scene?: 'bill' | 'avatar';
}
