/** Claims of the access token. Only the user id: roles are checked per request (phase 1d). */
export interface AccessTokenPayload {
  sub: string;
}

/** What the guard attaches to the request after validating the access token. */
export interface AuthenticatedUser {
  id: string;
}
