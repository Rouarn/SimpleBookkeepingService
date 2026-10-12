import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/** 消息类型：超预算提醒 / 安全告警 / 月度账单报告。 */
export type MessageType = 'budget_over' | 'security' | 'monthly_report';

/**
 * 站内消息（消息中心）。仅追加 + 软上限 200 条，超限删最旧；
 * 查询路径恒为 user_id 等值 + is_read 过滤 + created_at 倒序，联合索引覆盖。
 */
@Entity('messages', { comment: '站内消息' })
@Index('idx_user_read_created', ['userId', 'isRead', 'createdAt'])
export class Message {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: string;

  @Column({ type: 'bigint', unsigned: true, name: 'user_id' })
  userId: string;

  /** 消息类型：budget_over 超预算 / security 安全 / monthly_report 月报 */
  @Column({ type: 'varchar', length: 32 })
  type: MessageType;

  @Column({ type: 'varchar', length: 64 })
  title: string;

  @Column({ type: 'varchar', length: 255 })
  content: string;

  /** 结构化补充信息（JSON），可为空；读取时由 mysql2 自动反序列化为对象 */
  @Column({ type: 'json', nullable: true })
  payload: unknown;

  /** 0 未读 1 已读 */
  @Column({ type: 'tinyint', name: 'is_read', default: 0 })
  isRead: number;

  @Column({
    type: 'datetime',
    precision: 3,
    nullable: true,
    name: 'read_at',
  })
  readAt: Date | null;

  @CreateDateColumn({
    type: 'datetime',
    precision: 3,
    name: 'created_at',
    default: () => 'CURRENT_TIMESTAMP(3)',
  })
  createdAt: Date;
}
