import { route } from './_lib.mjs';
export const config = { path: '/go' };
export default (req, ctx) => route(req, ctx, 'go');
