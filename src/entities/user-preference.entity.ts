import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Book } from './book.entity.js';
import { Category } from './category.entity.js';
import { PayMethod } from './pay-method.entity.js';
import { User } from './user.entity.js';

export type FlowType = 'ALL' | 'EXPENSE' | 'INCOME';
export type ExpenseIncome = 'expense' | 'income';

/** 用户 UI 偏好（02 §2.8），对应用户端 app.js，每用户唯一一行。 */
@Entity('user_preferences', { comment: '用户偏好设置' })
export class UserPreference {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: string;

  @Index('uk_user', { unique: true })
  @Column({ type: 'bigint', unsigned: true, name: 'user_id' })
  userId: string;

  @ManyToOne(() => User, {
    createForeignKeyConstraints: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'user_id' })
  user?: User;

  // idx_active_book 已删除：全库对 user_preferences 的 WHERE 只有 user_id
  // （uk_user 唯一索引覆盖），active_book_id 无独立过滤查询（P2-04）
  @Column({
    type: 'bigint',
    unsigned: true,
    nullable: true,
    name: 'active_book_id',
  })
  activeBookId: string | null;

  @ManyToOne(() => Book, {
    createForeignKeyConstraints: false,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'active_book_id' })
  activeBook?: Book | null;

  @Column({ type: 'char', length: 7, nullable: true, name: 'flow_month' })
  flowMonth: string | null;

  @Column({
    type: 'enum',
    enum: ['ALL', 'EXPENSE', 'INCOME'],
    name: 'flow_type',
    default: 'ALL',
  })
  flowType: FlowType;

  @Column({ type: 'char', length: 7, nullable: true, name: 'stats_month' })
  statsMonth: string | null;

  @Column({
    type: 'enum',
    enum: ['expense', 'income'],
    name: 'stats_type',
    default: 'expense',
  })
  statsType: ExpenseIncome;

  @Column({
    type: 'enum',
    enum: ['expense', 'income'],
    name: 'last_bill_type',
    default: 'expense',
  })
  lastBillType: ExpenseIncome;

  // idx_last_pay 已删除：last_pay_method_id 仅随整行按 user_id 读写，无 WHERE 使用（P2-04）
  @Column({
    type: 'bigint',
    unsigned: true,
    nullable: true,
    name: 'last_pay_method_id',
  })
  lastPayMethodId: string | null;

  @ManyToOne(() => PayMethod, {
    createForeignKeyConstraints: false,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'last_pay_method_id' })
  lastPayMethod?: PayMethod | null;

  // idx_last_cat_exp 已删除：last_category_expense_id 仅随整行按 user_id 读写，无 WHERE 使用（P2-04）
  @Column({
    type: 'bigint',
    unsigned: true,
    nullable: true,
    name: 'last_category_expense_id',
  })
  lastCategoryExpenseId: string | null;

  @ManyToOne(() => Category, {
    createForeignKeyConstraints: false,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'last_category_expense_id' })
  lastCategoryExpense?: Category | null;

  // idx_last_cat_inc 已删除：last_category_income_id 仅随整行按 user_id 读写，无 WHERE 使用（P2-04）
  @Column({
    type: 'bigint',
    unsigned: true,
    nullable: true,
    name: 'last_category_income_id',
  })
  lastCategoryIncomeId: string | null;

  @ManyToOne(() => Category, {
    createForeignKeyConstraints: false,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'last_category_income_id' })
  lastCategoryIncome?: Category | null;

  @UpdateDateColumn({
    type: 'datetime',
    precision: 3,
    name: 'updated_at',
    default: () => 'CURRENT_TIMESTAMP(3)',
    onUpdate: 'CURRENT_TIMESTAMP(3)',
  })
  updatedAt: Date;
}
