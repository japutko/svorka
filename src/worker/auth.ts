import { createMiddleware } from "hono/factory";
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { AppEnv } from "./types";

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

// Cloudflare Access already blocks unauthenticated requests at the edge. When
// ACCESS_TEAM_DOMAIN and ACCESS_AUD are set, the Worker verifies the Access token
// too, so the workers.dev URL or a misconfigured route can't bypass the login.
export const requireAccess = createMiddleware<AppEnv>(async (c, next) => {
  const { ACCESS_TEAM_DOMAIN: team, ACCESS_AUD: aud } = c.env;
  if (!team || !aud) return next();
  const token = c.req.header("Cf-Access-Jwt-Assertion");
  if (!token) return c.json({ error: "Neprihlásený" }, 401);
  jwks ??= createRemoteJWKSet(new URL(`${team}/cdn-cgi/access/certs`));
  try {
    await jwtVerify(token, jwks, { issuer: team, audience: aud });
  } catch {
    return c.json({ error: "Neplatné prihlásenie" }, 401);
  }
  await next();
});
