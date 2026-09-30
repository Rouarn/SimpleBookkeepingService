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
import { User } from './user.entity.js';

/** 账本表（02 §2.3）。 */
@Entity('books', { comment: '账本表' })
@Index('idx_user_sort', ['userId', 'sortOrder', 'id'])
export class Book {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: string;

  @Column({ type: 'bigint', unsigned: true, name: 'user_id' })
  userId: string;

  @ManyToOne(() => User, {
    createForeignKeyConstraints: false,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'user_id' })
  user?: User;

  @Column({ type: 'varchar', length: 12, default: '个人账本' })
  name: string;

  /** 月预算（元），0 表示未设置；DECIMAL 经 mysql2 以字符串读出 */
  @Column({
    type: 'decimal',
    precision: 12,
    scale: 2,
    unsigned: true,
    default: 0,
  })
  budget: string;

  @Column({ type: 'boolean', name: 'is_default', default: false })
  isDefault: boolean;

  @Column({ type: 'int', name: 'sort_order', default: 0 })
  sortOrder: number;

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

  /** 预留软删字段，v1 不启用 */
  @Column({
    type: 'datetime',
    precision: 3,
    nullable: true,
    name: 'deleted_at',
  })
  deletedAt: Date | null;
}
