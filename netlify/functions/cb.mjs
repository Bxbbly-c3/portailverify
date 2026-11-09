import { route } from './_lib.mjs';
export const config = { path: '/cb' };
export default (req, ctx) => route(req, ctx, 'cb');
