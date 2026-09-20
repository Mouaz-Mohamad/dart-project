import { digest, randomToken } from "./crypto.js";

export interface SessionToken {
  id: string;
  secret: string;
}

export function createSessionSecret(): string {
  return randomToken(32);
}

export function serializeSessionToken(token: SessionToken): string {
  return `${token.id}.${token.secret}`;
}

export function parseSessionToken(value: string | undefined): SessionToken | null {
  if (!value) return null;
  const separator = value.indexOf(".");
  if (separator < 1) return null;
  const id = value.slice(0, separator);
  const secret = value.slice(separator + 1);
  if (!/^[0-9a-f-]{36}$/i.test(id) || !/^[A-Za-z0-9_-]{40,60}$/.test(secret)) return null;
  return { id, secret };
}

export function hashSessionSecret(secret: string, pepper: string): string {
  return digest(`session:${secret}`, pepper);
}

export function hashCsrfToken(token: string, pepper: string): string {
  return digest(`csrf:${token}`, pepper);
}
