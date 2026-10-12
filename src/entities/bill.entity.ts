import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { BillType } from './category.entity.js';
import { Book } from './book.entity.js';
import { Category } from './category.entity.js';
import { PayMethod } from './pay-method.entity.js';
import { User } from './user.entity.js';

/** 账单流水核心表（02 §2.6）。金额 DECIMAL 恒正，方向由 type 表达。 */
@Entity('bills', { comment: '账单流水表' })
@Index('idx_user_datetime', ['userId', 'recordDate', 'recordTime', 'createdAt'])
@Index('idx_user_type_date', ['userId', 'type', 'recordDate'])
// 账本维度列表/今日/分组：book_id 等值 + record_date 范围，索引序与
// ORDER BY record_date, record_time, created_at 一致可免 filesort；
// 与 idx_user_datetime 共存，优化器按全部账本/单账本扫描成本自选（P2-04）
@Index('idx_book_datetime', ['bookId', 'recordDate', 'recordTime', 'createdAt'])
// idx_category / idx_pay_method 单列索引已删除：全库无「不带 user_id 前缀」
// 的 category_id/pay_method_id 查询，列表过滤与统计 GROUP BY 均由
// user_id 前导索引覆盖（P2-04，详见 sql/002_indexes.sql）
@Index('idx_user_created', ['userId', 'createdAt'])
export class Bill {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: string;

  /** 冗余归属：隔离查询直接命中，不做 JOIN 鉴权 */
  @Column({ type: 'bigint', unsigned: true, name: 'user_id' })
  userId: string;

  @ManyToOne(() => User, {
    createForeignKeyConstraints: false,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'user_id' })
  user?: User;

  @Column({ type: 'bigint', unsigned: true, name: 'book_id' })
  bookId: string;

  @ManyToOne(() => Book, {
    createForeignKeyConstraints: false,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'book_id' })
  book?: Book;

  @Column({ type: 'bigint', unsigned: true, name: 'category_id' })
  categoryId: string;

  @ManyToOne(() => Category, {
    createForeignKeyConstraints: false,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'category_id' })
  category?: Category;

  @Column({ type: 'bigint', unsigned: true, name: 'pay_method_id' })
  payMethodId: string;

  @ManyToOne(() => PayMethod, {
    createForeignKeyConstraints: false,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'pay_method_id' })
  payMethod?: PayMethod;

  @Column({ type: 'enum', enum: ['expense', 'income'] })
  type: BillType;

  @Column({ type: 'decimal', precision: 12, scale: 2, unsigned: true })
  amount: string;

  @Column({ type: 'date', name: 'record_date' })
  recordDate: string;

  @Column({ type: 'time', name: 'record_time', default: '12:00:00' })
  recordTime: string;

  @Column({ type: 'varchar', length: 50, default: '' })
  remark: string;

  @CreateDateColumn({
    type: 'datetime',
    precision: 3,
    name: 'created_at',
    default: () => 'CURRENT_TIMESTAMP(3)',
  })
  createdAt: Date;

  @UpdateDateColumn({
    type: 'datetime',
    precision: 3,
    name: 'updated_at',
    default: () => 'CURRENT_TIMESTAMP(3)',
    onUpdate: 'CURRENT_TIMESTAMP(3)',
  })
  updatedAt: Date;

  /** 预留软删，v1 删除为物理删除 */
  @Column({
    type: 'datetime',
    precision: 3,
    nullable: true,
    name: 'deleted_at',
  })
  deletedAt: Date | null;
}
