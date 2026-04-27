// Fires when the server returns 401 so the app can show the login screen
export const onUnauthorized = { handler: null };

export async function apiFetch(method, path, body) {
  const res = await fetch('/api' + path, {
    method,
    credentials: 'include',   // send session cookie
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body:    body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) {
    onUnauthorized.handler?.();
    throw new Error('Not authenticated');
  }
  if (!res.ok) {
    const msg = await res.text().catch(() => res.statusText);
    throw new Error(msg);
  }
  return res.json();
}

export const getCIs        = ()       => apiFetch('GET',    '/cis');
export const createCI      = (data)   => apiFetch('POST',   '/cis', data);
export const updateCI      = (id, d)  => apiFetch('PUT',    `/cis/${id}`, d);
export const deleteCI      = (id)     => apiFetch('DELETE', `/cis/${id}`);
export const getActiveRuns = ()       => apiFetch('GET',    '/active-runs');
export const getSeqRuns    = ()       => apiFetch('GET',    '/seq-runs');
export const startSeq      = (id, d)  => apiFetch('POST',   `/seq/${id}`, d);
export const stopSeq       = (id)     => apiFetch('POST',   `/seq/${id}/stop`);
export const sendDecision  = (id, d)  => apiFetch('POST',   `/seq/${id}/decision`, d);
export const getMe         = ()       => apiFetch('GET',    '/auth/me');
export const login         = (d)      => apiFetch('POST',   '/auth/login', d);
export const logout        = ()       => apiFetch('POST',   '/auth/logout');
export const changePassword= (d)      => apiFetch('POST',   '/auth/change-password', d);
export const listUsers     = ()       => apiFetch('GET',    '/users');
export const createUser    = (d)      => apiFetch('POST',   '/users', d);
export const updateUser    = (u, d)   => apiFetch('PUT',    `/users/${u}`, d);
export const deleteUser    = (u)      => apiFetch('DELETE', `/users/${u}`);

export const getLog = (id, st, mod) =>
  fetch(`/api/logs/${id}/${st}/${encodeURIComponent(mod)}`, { credentials: 'include' })
    .then(r => r.ok ? r.text() : null)
    .catch(() => null);
