import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { from, Observable } from 'rxjs';
import { concatMap, map } from 'rxjs/operators';
import { AuditLogService } from '../audit-log.service';

interface AdminRequest {
  user?: { id: string };
  method: string;
  url: string;
  params: Record<string, string>;
  body: Record<string, unknown>;
}

function resolveAction(method: string, url: string): string {
  const path = url.split('?')[0];
  if (method === 'GET' && path.endsWith('/admin/savings/overview'))
    return 'VIEW_SAVINGS_OVERVIEW';
  if (method === 'GET' && path.includes('/admin/savings/yield'))
    return 'VIEW_YIELD_OVERVIEW';
  if (method === 'PATCH' && path.includes('/ban')) return 'BAN_USER';
  if (method === 'PATCH' && path.includes('/unban')) return 'UNBAN_USER';
  if (method === 'PATCH' && path.includes('/role')) return 'UPDATE_USER_ROLE';
  if (method === 'POST' && path.includes('/bulk-action'))
    return 'BULK_USER_ACTION';
  if (method === 'POST' && path.includes('/resolve')) return 'RESOLVE_MARKET';
  if (
    method === 'PATCH' &&
    path.includes('/feature') &&
    !path.includes('/unfeature')
  )
    return 'FEATURE_MARKET';
  if (method === 'PATCH' && path.includes('/unfeature'))
    return 'UNFEATURE_MARKET';
  if (method === 'PATCH' && path.includes('/moderate'))
    return 'MODERATE_COMMENT';
  if (method === 'PATCH' && path.includes('/flags')) return 'RESOLVE_FLAG';
  if (method === 'DELETE' && path.includes('/competitions'))
    return 'CANCEL_COMPETITION';
  return `${method}:${path}`;
}

function resolveTarget(
  url: string,
  params: Record<string, string>,
): { target_type: string | null; target_id: string | null } {
  const path = url.split('?')[0];
  const id = params?.id ?? null;
  if (path.includes('/users')) return { target_type: 'user', target_id: id };
  if (path.includes('/markets'))
    return { target_type: 'market', target_id: id };
  if (path.includes('/competitions'))
    return { target_type: 'competition', target_id: id };
  if (path.includes('/comments'))
    return { target_type: 'comment', target_id: id };
  if (path.includes('/flags')) return { target_type: 'flag', target_id: id };
  if (path.endsWith('/admin/savings/overview')) {
    return { target_type: 'savings', target_id: 'overview' };
  }
  if (path.includes('/admin/savings/yield')) {
    return { target_type: 'savings', target_id: 'yield' };
  }
  return { target_type: null, target_id: id };
}

interface BulkResponse {
  succeeded?: number;
  failed?: number;
  results?: { user_id: string; success: boolean; code?: string }[];
}

function buildMetadata(
  action: string,
  body: Record<string, unknown> | undefined,
  response: unknown,
): Record<string, unknown> | null {
  if (action !== 'BULK_USER_ACTION' || !response) return body ?? null;

  const { succeeded, failed, results = [] } = response as BulkResponse;
  return {
    ...(body ?? {}),
    outcome: {
      succeeded,
      failed,
      succeeded_ids: results.filter((r) => r.success).map((r) => r.user_id),
      failures: results
        .filter((r) => !r.success)
        .map((r) => ({ user_id: r.user_id, code: r.code })),
    },
  };
}

@Injectable()
export class AdminAuditInterceptor implements NestInterceptor {
  constructor(private readonly auditLogService: AuditLogService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<AdminRequest>();
    const { user, method, url, params, body } = req;

    return next.handle().pipe(
      concatMap((response) => {
        if (!user) return from([response]);

        const action = resolveAction(method, url);
        const { target_type, target_id } = resolveTarget(url, params);

        return from(
          this.auditLogService.log({
            actor_id: user.id,
            action,
            target_type,
            target_id,
            metadata: buildMetadata(action, body, response),
          }),
        ).pipe(map(() => response));
      }),
    );
  }
}
