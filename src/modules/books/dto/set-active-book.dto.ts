import { Matches } from 'class-validator';

const ID_PATTERN = /^\d{1,19}$/;

export class SetActiveBookDto {
  @Matches(ID_PATTERN, { message: '账本 id 非法' })
  bookId!: string;
}
