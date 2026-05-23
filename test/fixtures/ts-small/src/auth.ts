import { createHash } from "node:crypto";

export interface User {
  id: string;
  email: string;
  role: "admin" | "user";
}

export type AuthResult = { ok: true; user: User } | { ok: false; error: string };

/**
 * Hash a password with salt.
 */
export function hashPassword(password: string, salt: string): string {
  return createHash("sha256").update(salt + password).digest("hex");
}

export class AuthService {
  private users: Map<string, User> = new Map();

  register(email: string, password: string): AuthResult {
    if (this.users.has(email)) return { ok: false, error: "already registered" };
    const user: User = { id: Math.random().toString(36).slice(2), email, role: "user" };
    this.users.set(email, user);
    return { ok: true, user };
  }

  login(email: string): AuthResult {
    const user = this.users.get(email);
    if (!user) return { ok: false, error: "not found" };
    return { ok: true, user };
  }
}

export default AuthService;
