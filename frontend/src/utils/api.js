export async function apiFetch(method, path, body) {
  const res = await fetch('/api' + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body:    body ? JSON.stringify(body) : undefined,
  });
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
export const getLog        = (id, st, mod) =>
  fetch(`/api/logs/${id}/${st}/${encodeURIComponent(mod)}`)
    .then(r => r.ok ? r.text() : null)
    .catch(() => null);
