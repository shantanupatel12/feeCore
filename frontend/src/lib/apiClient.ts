import type { AuthSessionResponse } from '@feecore/shared-types';

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '/api/v1';
const TOKEN_KEY = 'feecore.accessToken';
const SESSION_KEY = 'feecore.session';

let onUnauthorized: (() => void) | null = null;

export function setUnauthorizedHandler(handler: () => void) {
  onUnauthorized = handler;
}

function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

export function isTokenExpired(token: string): boolean {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    if (payload.exp && Date.now() >= payload.exp * 1000) {
      return true;
    }
    return false;
  } catch {
    return true;
  }
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
}

async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const url = path.startsWith('http') ? path : `${API_BASE_URL}${path}`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers ?? {}),
  };

  const token = getToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(url, {
    method: options.method ?? 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (response.status === 401) {
    onUnauthorized?.();
    const body = await response.json().catch(() => null);
    throw new ApiError(
      (body as { message?: string })?.message ?? 'Session expired. Please log in again.',
      401,
      body,
    );
  }

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const message =
      (body as { message?: string })?.message ??
      (body as { error?: string })?.error ??
      response.statusText;
    throw new ApiError(message, response.status, body);
  }

  if (response.status === 204) {
    return {} as T;
  }

  const text = await response.text();
  if (!text) {
    return {} as T;
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    return text as unknown as T;
  }
}

export const apiClient = {
  get: <T>(path: string, headers?: Record<string, string>) =>
    apiRequest<T>(path, { method: 'GET', headers }),
  post: <T>(path: string, body?: unknown, headers?: Record<string, string>) =>
    apiRequest<T>(path, { method: 'POST', body, headers }),
  put: <T>(path: string, body?: unknown, headers?: Record<string, string>) =>
    apiRequest<T>(path, { method: 'PUT', body, headers }),
  patch: <T>(path: string, body?: unknown, headers?: Record<string, string>) =>
    apiRequest<T>(path, { method: 'PATCH', body, headers }),
  del: <T>(path: string, headers?: Record<string, string>) =>
    apiRequest<T>(path, { method: 'DELETE', headers }),
};

export { TOKEN_KEY, SESSION_KEY };

export const authStorage = {
  save: (session: AuthSessionResponse) => {
    localStorage.setItem(TOKEN_KEY, session.accessToken);
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  },
  load: (): AuthSessionResponse | null => {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    try {
      const session: AuthSessionResponse = JSON.parse(raw);
      if (!session.accessToken || isTokenExpired(session.accessToken)) {
        authStorage.clear();
        return null;
      }
      return session;
    } catch {
      authStorage.clear();
      return null;
    }
  },
  clear: () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(SESSION_KEY);
  },
};
