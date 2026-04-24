export class AppError extends Error {
  constructor(public readonly code: string, message: string, public override readonly cause?: unknown) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class ValidationError extends AppError {
  constructor(message: string, cause?: unknown) {
    super('INVALID_INPUT', message, cause);
  }
}

export class UpstreamError extends AppError {
  constructor(public readonly provider: 'claude' | 'codex' | string, message: string, cause?: unknown) {
    super('UPSTREAM_LLM_FAIL', `[${provider}] ${message}`, cause);
  }
}

export class MCPError extends AppError {
  constructor(public readonly tool: string, message: string, cause?: unknown) {
    super('MCP_FAIL', `[${tool}] ${message}`, cause);
  }
}

export class WorkflowTimeoutError extends AppError {
  constructor(message: string) {
    super('WORKFLOW_TIMEOUT', message);
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string) {
    super('NOT_FOUND', `${resource} not found`);
  }
}

export type AuthFailReason =
  | 'missing-cookie'
  | 'invalid-cookie'
  | 'bad-signature'
  | 'expired-link'
  | 'unknown-token'
  | 'forbidden';

export class AuthError extends AppError {
  constructor(public readonly reason: AuthFailReason) {
    const code = reason === 'forbidden' ? 'AUTH_FORBIDDEN' : 'AUTH_REQUIRED';
    super(code, `auth failed: ${reason}`);
  }
}
