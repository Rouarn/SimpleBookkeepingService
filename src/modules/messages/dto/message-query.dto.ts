import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsNumber,
  IsOptional,
  Min,
  Validate,
  ValidatorConstraint,
  type ValidationArguments,
  type ValidatorConstraintInterface,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto.js';

/** GET /users/me/messages 分页查询（page/pageSize 惯例归一化）。 */
export class MessageListQueryDto extends PaginationQueryDto {}

interface MarkReadDtoShape {
  ids?: unknown;
  all?: unknown;
}

/** 跨字段校验：ids 与 all 必须二选一（恰传其一）。 */
@ValidatorConstraint({ name: 'markReadTarget', async: false })
export class MarkReadTargetConstraint implements ValidatorConstraintInterface {
  validate(_value: unknown, args: ValidationArguments): boolean {
    const dto = args.object as MarkReadDtoShape;
    const hasIds = Array.isArray(dto?.ids) && dto.ids.length > 0;
    if (hasIds) return dto.all === undefined;
    return dto?.all === true && dto.ids === undefined;
  }

  defaultMessage(): string {
    return 'ids 与 all 必须二选一';
  }
}

/** PUT /users/me/messages/read 入参：标记指定 id 或全部已读。 */
export class MarkReadDto {
  // 关系校验统一挂在 ids 上（经 args.object 读 all）：自定义装饰器无
  // IsOptional 条件，ids 缺省时同样执行，覆盖「只传 all」与「两者都不传」
  @IsArray({ message: 'ids 必须为数组' })
  @IsNumber({}, { each: true, message: 'ids 元素必须为数字' })
  @Min(1, { each: true, message: 'ids 元素必须为正整数' })
  @ArrayMaxSize(200, { message: 'ids 单次最多 200 个' })
  @IsOptional()
  @Validate(MarkReadTargetConstraint)
  ids?: number[];

  @IsBoolean({ message: 'all 必须为布尔值' })
  @IsOptional()
  all?: boolean;
}
