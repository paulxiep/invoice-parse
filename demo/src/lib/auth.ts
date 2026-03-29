/**
 * Auth state manager — Google OAuth2 (GIS) + API key fallback.
 * Token is held in memory only (not persisted to storage).
 */

export type AuthMode = "oauth" | "apikey";

export interface AuthCredential {
  mode: AuthMode;
  apiKey?: string;
  accessToken?: string;
}

type AuthChangeCallback = (credential: AuthCredential | null) => void;

// --- Module state ---
let credential: AuthCredential | null = null;
let tokenClient: google.accounts.oauth2.TokenClient | null = null;
let onChange: AuthChangeCallback | null = null;

const SCOPE = [
  "https://www.googleapis.com/auth/generative-language.peruserquota",
  "https://www.googleapis.com/auth/generative-language.retriever",
].join(" ");

/**
 * Initialise the GIS token client.  Call once on page load.
 * Returns false if GIS library is not available (blocked / failed to load).
 */
export function initOAuth(
  clientId: string,
  callback: AuthChangeCallback,
): boolean {
  onChange = callback;

  if (typeof google === "undefined" || !google.accounts?.oauth2) {
    return false;
  }

  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: SCOPE,
    callback: (response) => {
      if (response.error) {
        // User denied or other error — clear any previous OAuth credential
        if (credential?.mode === "oauth") {
          credential = null;
          onChange?.(null);
        }
        return;
      }
      credential = { mode: "oauth", accessToken: response.access_token };
      onChange?.(credential);
    },
    error_callback: () => {
      // Popup closed or blocked — no action needed
    },
  });

  return true;
}

/** Open the Google consent popup. */
export function requestOAuthToken(): void {
  tokenClient?.requestAccessToken();
}

/** Attempt silent re-auth (no prompt). Returns a promise that resolves with the new credential or null. */
export function silentReauth(): Promise<AuthCredential | null> {
  return new Promise((resolve) => {
    if (!tokenClient) {
      resolve(null);
      return;
    }

    // Temporarily swap the callback to capture the result
    const origOnChange = onChange;
    const timeout = setTimeout(() => {
      onChange = origOnChange;
      resolve(null);
    }, 10_000);

    onChange = (cred) => {
      clearTimeout(timeout);
      onChange = origOnChange;
      origOnChange?.(cred);
      resolve(cred);
    };

    tokenClient.requestAccessToken({ prompt: "" });
  });
}

/** Revoke OAuth token and clear credential. */
export function revokeOAuth(): void {
  if (credential?.mode === "oauth" && credential.accessToken) {
    google.accounts.oauth2.revoke(credential.accessToken);
  }
  credential = null;
  onChange?.(null);
}

/** Set an API-key credential. */
export function setApiKey(key: string): void {
  if (key) {
    credential = { mode: "apikey", apiKey: key };
  } else {
    // Only clear if current credential is apikey mode
    if (!credential || credential.mode === "apikey") {
      credential = null;
    }
  }
  onChange?.(credential);
}

/** Get current credential (may be null). */
export function getCredential(): AuthCredential | null {
  return credential;
}

/** Check whether we have a usable credential. */
export function isAuthenticated(): boolean {
  if (!credential) return false;
  if (credential.mode === "apikey") return !!credential.apiKey;
  if (credential.mode === "oauth") return !!credential.accessToken;
  return false;
}
