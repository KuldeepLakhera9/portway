const isLocal = typeof window !== 'undefined' && window.location.hostname === 'localhost';

export const API_BASE = isLocal 
  ? 'http://localhost:3010' 
  : 'https://api.kuldeeplakhera.me';

export const WS_BASE = isLocal 
  ? 'ws://localhost:3010' 
  : 'wss://api.kuldeeplakhera.me';

export function getAuthToken(): string | null {
  if (typeof window !== 'undefined') {
    return localStorage.getItem('portway_token');
  }
  return null;
}

export function setAuthToken(token: string) {
  localStorage.setItem('portway_token', token);
}

export function clearAuthToken() {
  localStorage.removeItem('portway_token');
}

export async function apiFetch(path: string, options: RequestInit = {}) {
  const token = getAuthToken();
  const headers = new Headers(options.headers || {});
  
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });
  
  if (res.status === 401) {
    clearAuthToken();
    if (typeof window !== 'undefined') {
      window.location.href = '/';
    }
  }
  
  return res;
}
