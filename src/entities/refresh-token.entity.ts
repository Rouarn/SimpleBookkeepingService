import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from './user.entity.js';

/** 刷新令牌（02 §2.2）：库中只存 SHA256，支持轮换、吊销与重用检测。 */
@Entity('refresh_tokens')
@Index('idx_user_expire', ['userId', 'expiresAt'])
export class RefreshToken {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: string;

  @Column({ type: 'bigint', unsigned: true, name: 'user_id' })
  userId: string;

  @ManyToOne(() => User, {
    createForeignKeyConstraints: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'user_id' })
  user?: User;

  @Index('uk_jti', { unique: true })
  @Column({ type: 'char', length: 36 })
  jti: string;

  @Column({ type: 'char', length: 64, name: 'token_hash' })
  tokenHash: string;

  @Column({ type: 'varchar', length: 64, name: 'device_id', default: '' })
  deviceId: string;

  @Column({ type: 'varchar', length: 16, default: '' })
  platform: string;

  @Column({ type: 'datetime', precision: 3, name: 'expires_at' })
  expiresAt: Date;

  @Column({
    type: 'datetime',
    precision: 3,
    nullable: true,
    name: 'revoked_at',
  })
  revokedAt: Date | null;

  @Column({
    type: 'datetime',
    precision: 3,
    nullable: true,
    name: 'last_used_at',
  })
  lastUsedAt: Date | null;

  @CreateDateColumn({
    type: 'datetime',
    precision: 3,
    name: 'created_at',
    default: () => 'CURRENT_TIMESTAMP(3)',
  })
  createdAt: Date;
}
