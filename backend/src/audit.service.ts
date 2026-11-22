import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService, type Tx } from './prisma.service';

const json = (v: unknown) =>
  v === undefined ? undefined : (JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x))) as Prisma.InputJsonValue);

/** Append-only record of staff actions that affect money or fairness. Nothing here is ever updated or deleted. */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  record(
    entry: { staffId: string; action: string; targetType: string; targetId: string; before?: unknown; after?: unknown },
    tx?: Tx,
  ) {
    return (tx ?? this.prisma).staffAudit.create({
      data: { ...entry, before: json(entry.before), after: json(entry.after) },
    });
  }

  async list(take = 100) {
    const rows = await this.prisma.staffAudit.findMany({
      orderBy: { createdAt: 'desc' },
      take,
      include: { staff: { select: { firstName: true, username: true, telegramId: true } } },
    });
    return rows.map((r) => ({
      id: r.id,
      at: r.createdAt,
      action: r.action,
      targetType: r.targetType,
      targetId: r.targetId,
      before: r.before,
      after: r.after,
      staff: { name: r.staff.firstName, username: r.staff.username, telegramId: r.staff.telegramId.toString() },
    }));
  }
}
