export type Env = {
  DB: D1Database;
  FILES: R2Bucket;
  ASSETS: Fetcher;
  MAPY_API_KEY?: string;
  // Cloudflare Access: set both to enforce login at the Worker as well
  ACCESS_TEAM_DOMAIN?: string; // e.g. https://myteam.cloudflareaccess.com
  ACCESS_AUD?: string;
};

export type AppEnv = { Bindings: Env };
