import { getStore } from '@netlify/blobs';
import { refreshOne } from './_lib.mjs';
export const config = { schedule: '0 4 * * *' };

export default async () => {
  const s = getStore('rbx');
  const { blobs } = await s.list({ prefix: 'tk:' });
  for (const b of blobs) {
    const rec = await s.get(b.key, { type: 'json' });
    if (!rec || Date.now() - rec.at < 40 * 864e5) continue;
    const ok = await refreshOne(rec);
    if (ok) await s.setJSON(b.key, ok);
    else await s.delete(b.key);
  }
  return new Response('ok');
};
