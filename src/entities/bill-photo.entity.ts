import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Bill } from './bill.entity.js';

/**
 * 账单凭证图片（02 §2.7），每账单最多 3 张；url 只存相对路径 key。
 * 注意：生产库通过 sql/003_foreign_keys.sql 维护到 bills(id,user_id) 的
 * ON DELETE CASCADE 外键（应用层 createForeignKeyConstraints:false，外键只由 SQL 目录管理）。
 */
@Entity('bill_photos', { comment: '账单凭证图片' })
@Index('uk_bill_sort', ['billId', 'sortOrder'], { unique: true })
// 实际访问路径均为 user_id 等值 + bill_id（IN/等值）+ sort_order 排序：
// 列表批量取图（user_id, bill_id IN, ORDER BY bill_id, sort_order）、
// 详情/删除（user_id, bill_id 等值），联合索引一并覆盖（P2-04）
@Index('idx_user_bill_sort', ['userId', 'billId', 'sortOrder'])
export class BillPhoto {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: string;

  @Column({ type: 'bigint', unsigned: true, name: 'bill_id' })
  billId: string;

  @ManyToOne(() => Bill, {
    createForeignKeyConstraints: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'bill_id' })
  bill?: Bill;

  @Column({ type: 'bigint', unsigned: true, name: 'user_id' })
  userId: string;

  @Column({ type: 'varchar', length: 512 })
  url: string;

  @Column({ type: 'tinyint', unsigned: true, name: 'sort_order', default: 0 })
  sortOrder: number;

  @CreateDateColumn({
    type: 'datetime',
    precision: 3,
    name: 'created_at',
    default: () => 'CURRENT_TIMESTAMP(3)',
  })
  createdAt: Date;
}
