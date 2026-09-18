export interface FacebookProfile {
  facebookId: string;
  name: string;
  email: string;
  avatarUrl: string | null;
}

export interface FacebookOAuthClient {
  exchangeCodeForProfile(code: string): Promise<FacebookProfile>;
}

export class FacebookAuthError extends Error {
  constructor(message = "Facebook sign-in failed") {
    super(message);
  }
}

const GRAPH_TOKEN_URL = "https://graph.facebook.com/v19.0/oauth/access_token";
const GRAPH_ME_URL = "https://graph.facebook.com/v19.0/me";

// Unlike JWT_SECRET (read eagerly in tokenService.ts), these are only read the
// first time a Facebook OAuth exchange actually happens: the default client is
// constructed unconditionally by createApp() on every boot (including every
// test run that doesn't inject a fake client), so failing fast in the
// constructor would require these real third-party secrets to exist in every
// environment, including .env.test, which is not appropriate.
function readRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} environment variable must be set`);
  }
  return value;
}

export class FacebookGraphOAuthClient implements FacebookOAuthClient {
  async exchangeCodeForProfile(code: string): Promise<FacebookProfile> {
    const appId = readRequiredEnv("FACEBOOK_APP_ID");
    const appSecret = readRequiredEnv("FACEBOOK_APP_SECRET");
    const redirectUri = readRequiredEnv("FACEBOOK_REDIRECT_URI");

    const tokenUrl = new URL(GRAPH_TOKEN_URL);
    tokenUrl.searchParams.set("client_id", appId);
    tokenUrl.searchParams.set("client_secret", appSecret);
    tokenUrl.searchParams.set("redirect_uri", redirectUri);
    tokenUrl.searchParams.set("code", code);

    const tokenResponse = await fetch(tokenUrl);
    if (!tokenResponse.ok) {
      throw new FacebookAuthError();
    }
    const tokenBody = (await tokenResponse.json()) as { access_token?: string };
    if (typeof tokenBody.access_token !== "string") {
      throw new FacebookAuthError();
    }

    const meUrl = new URL(GRAPH_ME_URL);
    meUrl.searchParams.set("fields", "id,name,email,picture");
    meUrl.searchParams.set("access_token", tokenBody.access_token);

    const meResponse = await fetch(meUrl);
    if (!meResponse.ok) {
      throw new FacebookAuthError();
    }
    const profile = (await meResponse.json()) as {
      id?: string;
      name?: string;
      email?: string;
      picture?: { data?: { url?: string } };
    };
    if (typeof profile.id !== "string" || typeof profile.name !== "string" || typeof profile.email !== "string") {
      throw new FacebookAuthError();
    }

    return {
      facebookId: profile.id,
      name: profile.name,
      email: profile.email,
      avatarUrl: profile.picture?.data?.url ?? null,
    };
  }
}
