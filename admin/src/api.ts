export interface Money {
  minor: string;
  birr: string;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

const KEY = 'bingo.staff';
let token = '';
try {
  token = localStorage.getItem(KEY) ?? '';
} catch {
  /* storage blocked: sign in each visit */
}

export const session = {
  get token() {
    return token;
  },
  set(t: string) {
    token = t;
    try {
      localStorage.setItem(KEY, t);
    } catch {
      /* ignore */
    }
  },
  clear() {
    token = '';
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
  },
};

/** Called when the server says the session is over, so the app can show the sign-in form. */
let onSignedOut: () => void = () => undefined;
export const whenSignedOut = (fn: () => void) => {
  onSignedOut = fn;
};

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: init.method ?? (init.body ? 'POST' : 'GET'),
      headers: {
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Cannot reach the server. Check that it is running.');
  }
  const data = await res.json().catch(() => null);
  if (res.status === 401 && token) {
    session.clear();
    onSignedOut();
  }
  if (!res.ok) throw new ApiError(res.status, data?.code ?? 'ERROR', data?.message ?? `Error ${res.status}`);
  return data as T;
}

export const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
