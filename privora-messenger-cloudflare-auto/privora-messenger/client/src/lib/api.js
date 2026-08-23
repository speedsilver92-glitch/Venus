export const API_URL = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

export async function api(path, options = {}) {
  const token = localStorage.getItem('privora_token');
  const headers = { ...(options.headers || {}) };
  if (!(options.body instanceof FormData)) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`${API_URL}${path}`, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}
