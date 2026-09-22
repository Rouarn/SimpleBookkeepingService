import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/** 用户表（02 §2.1）。实体不作为接口出参，必须经 VO 序列化。 */
@Entity('users')
export class User {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: string;

  @Index('uk_phone', { unique: true })
  @Column({ type: 'varchar', length: 20 })
  phone: string;

  @Column({ type: 'varchar', length: 100, name: 'password_hash' })
  passwordHash: string;

  @Column({ type: 'varchar', length: 12, default: '小绿' })
  nickname: string;

  @Column({ type: 'varchar', length: 512, name: 'avatar_url', default: '' })
  avatarUrl: string;

  @Column({ type: 'date', name: 'join_date' })
  joinDate: string;

  /** 状态：1 正常 0 冻结 */
  @Column({ type: 'tinyint', unsigned: true, default: 1 })
  status: number;

  @Column({
    type: 'datetime',
    precision: 3,
    nullable: true,
    name: 'last_login_at',
  })
  lastLoginAt: Date | null;

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
