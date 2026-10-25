export const ErrorCodes = Object.freeze({
  InvalidDefinition: 'INVALID_DEFINITION',
  InvalidSetting: 'INVALID_SETTING',
  DuplicateId: 'DUPLICATE_ID',
  NotFound: 'NOT_FOUND',
  Unsupported: 'UNSUPPORTED',
  ApiVersion: 'API_VERSION',
  Dependency: 'DEPENDENCY',
  NotAllowed: 'NOT_ALLOWED',
  Request: 'REQUEST',
  Timeout: 'TIMEOUT',
  Storage: 'STORAGE',
  LoadFailed: 'LOAD_FAILED',
});

export class ClientError extends Error {
  constructor(code, message, { cause, ...details } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'ClientError';
    this.code = code;
    Object.assign(this, details);
  }
}

/** Something a request to an API service sent back, or failed with. */
export class ApiError extends ClientError {
  constructor(message, { status = 0, body = null, url, method, cause } = {}) {
    super(ErrorCodes.Request, message, { cause, status, body, url, method });
    this.name = 'ApiError';
  }
}

/** Marks an error with where it came from (plugin, theme, page…) without replacing it. */
export function tagError(error, tags) {
  const err = error instanceof Error ? error : new Error(String(error));
  for (const [key, value] of Object.entries(tags)) {
    if (value !== undefined && err[key] === undefined) {
      try {
        err[key] = value;
      } catch {
        // a frozen error keeps its own tags
      }
    }
  }
  return err;
}
