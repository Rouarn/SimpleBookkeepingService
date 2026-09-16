import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type BillType = 'expense' | 'income';

/** 收支分类字典（02 §2.4），系统种子数据、全局只读。 */
@Entity('categories')
@Index('idx_type_sort', ['type', 'status', 'sortOrder'])
@Index('uk_type_name', ['type', 'name'], { unique: true })
export class Category {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: string;

  @Column({ type: 'enum', enum: ['expense', 'income'] })
  type: BillType;

  @Column({ type: 'varchar', length: 16 })
  name: string;

  @Column({ type: 'varchar', length: 16, default: '📦' })
  icon: string;

  @Column({ type: 'char', length: 7, default: '#ff6a3d' })
  color: string;

  @Column({ type: 'char', length: 7, default: '#fff0ea' })
  bg: string;

  @Column({ type: 'tinyint', unsigned: true, name: 'sort_order', default: 0 })
  sortOrder: number;

  @Column({ type: 'boolean', name: 'is_system', default: true })
  isSystem: boolean;

  /** 1 启用 0 停用 */
  @Column({ type: 'tinyint', unsigned: true, default: 1 })
  status: number;

  @CreateDateColumn({ type: 'datetime', precision: 3, name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'datetime', precision: 3, name: 'updated_at' })
  updatedAt: Date;
}
