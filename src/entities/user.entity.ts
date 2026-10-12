import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/** 用户表（02 §2.1）。实体不作为接口出参，必须经 VO 序列化。 */
@Entity('users', { comment: '用户表' })
export class User {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: string;

  /**
   * 手机号唯一键。注销时改写为 'del:{id}:{随机10位}' 以释放占用，
   * 最大长度 4+19+1+10=34，故列宽 40（sql/004_messages.sql 同步 MODIFY）。
   */
  @Index('uk_phone', { unique: true })
  @Column({ type: 'varchar', length: 40 })
  phone: string;

  @Column({ type: 'varchar', length: 100, name: 'password_hash' })
  passwordHash: string;

  @Column({ type: 'varchar', length: 12, default: '小绿' })
  nickname: string;

  @Column({ type: 'varchar', length: 512, name: 'avatar_url', default: '' })
  avatarUrl: string;

  @Column({ type: 'date', name: 'join_date' })
  joinDate: string;

  /** 状态：1 正常 0 冻结 2 注销（注销保留匿名行，业务数据由注销清理任务回收） */
  @Column({ type: 'tinyint', unsigned: true, default: 1 })
  status: number;

  /**
   * 令牌版本号（P1-01）：签发 access JWT 时写入 ver 声明，JWT 守卫比对校验。
   * 修改密码 / 全员登出时自增，使既有 access token 全部失效。
   */
  @Column({ type: 'int', unsigned: true, name: 'token_version', default: 0 })
  tokenVersion: number;

  @Column({
    type: 'datetime',
    precision: 3,
    nullable: true,
    name: 'last_login_at',
  })
  lastLoginAt: Date | null;

  /** 申请注销时刻（status=2 时写入）；保留期满由清理任务回收业务数据 */
  @Column({
    type: 'datetime',
    precision: 3,
    nullable: true,
    name: 'deactivated_at',
  })
  deactivatedAt: Date | null;

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
