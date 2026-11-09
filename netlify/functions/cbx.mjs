import { route } from './_lib.mjs';
export const config = { path: '/cbx' };
export default (req, ctx) => route(req, ctx, 'cbx');
