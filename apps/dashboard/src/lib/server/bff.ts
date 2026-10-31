/**
 * The two kinds of data endpoint (spec 008 `contracts/dashboard-bff.md`): reads need a
 * session; writes check the origin first, then the session. Every answer is `no-store`.
 */
import "server-only";
import { serverContext } from "./context";
import { compose, type RouteHandler, withNoStore, withOrigin, withSession } from "./handler";
import { SESSION_COOKIE } from "./session-cookie";

const session = withSession(SESSION_COOKIE, (cookie) => serverContext().sessions.isValid(cookie));
const origin = withOrigin(() => serverContext().env.publicOrigin);

export const read = (handler: RouteHandler): RouteHandler => compose(withNoStore, session)(handler);

export const write = (handler: RouteHandler): RouteHandler =>
  compose(withNoStore, origin, session)(handler);

/** Writes that need no session (sign-in): origin only. */
export const publicWrite = (handler: RouteHandler): RouteHandler =>
  compose(withNoStore, origin)(handler);
