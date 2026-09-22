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

/** 账单凭证图片（02 §2.7），每账单最多 3 张；url 只存相对路径 key。 */
@Entity('bill_photos')
@Index('uk_bill_sort', ['billId', 'sortOrder'], { unique: true })
@Index('idx_user', ['userId'])
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
