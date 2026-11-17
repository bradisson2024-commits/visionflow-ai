export class AppError extends Error {
  constructor(status, message, extra = {}) { super(message); this.status = status; Object.assign(this, extra); }
}
export class ServiceError extends AppError {
  constructor(service, message, { status = 502, retryable = false } = {}) { super(status, `${service}: ${message}`, { service, retryable }); }
}
