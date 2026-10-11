import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * 上传场景入参（P2-08）：HTTP 入口仅允许 bill。
 * 此处只做字符串形态校验，scene 白名单（avatar 拒绝并返回 UPLOAD_SCENE_INVALID）
 * 在 UploadsService 内显式判定；头像唯一入口为 POST /users/me/avatar，
 * 该接口由 UsersService 内部直接复用 StorageService，不经过 /uploads/image。
 */
export class UploadSceneDto {
  @IsOptional()
  @IsString()
  @MaxLength(16)
  scene?: string;
}
