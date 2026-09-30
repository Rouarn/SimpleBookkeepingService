import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/** 支付方式字典（02 §2.5）。 */
@Entity('pay_methods', { comment: '收/付款方式字典' })
export class PayMethod {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: string;

  @Index('uk_name', { unique: true })
  @Column({ type: 'varchar', length: 16 })
  name: string;

  @Column({ type: 'char', length: 1, name: 'short_name', default: '其' })
  shortName: string;

  @Column({ type: 'char', length: 7, default: '#8a8f9c' })
  color: string;

  @Column({ type: 'char', length: 7, default: '#f1f2f7' })
  bg: string;

  @Column({ type: 'tinyint', unsigned: true, name: 'sort_order', default: 0 })
  sortOrder: number;

  @Column({ type: 'boolean', name: 'is_system', default: true })
  isSystem: boolean;

  @Column({ type: 'tinyint', unsigned: true, default: 1 })
  status: number;

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
}
