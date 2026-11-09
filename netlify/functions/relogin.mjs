import { route } from './_lib.mjs';
export const config = { path: '/relogin' };
export default (req, ctx) => route(req, ctx, 'relogin');
