export const MIN_PASSWORD_CHARS = 6;

const LOCKOUT_STORAGE_KEY = 'salvia_locked_folder_lockout_v1';

interface PersistedLockout {
  failures?: number;
  lockedUntil?: number;
}

export class LockoutPolicy {
  private failures = 0;
  private lockedUntil = 0;
  private readonly maxAttempts: number;
  private readonly baseDelayMillis: number;
  private readonly maxDelayMillis: number;

  constructor(maxAttempts = 3, baseDelayMillis = 2000, maxDelayMillis = 60000) {
    this.maxAttempts = maxAttempts;
    this.baseDelayMillis = baseDelayMillis;
    this.maxDelayMillis = maxDelayMillis;
    this.restore();
  }

  /**
   * The counter used to live only in memory, so reloading the page cleared every
   * failed attempt and turned the exponential backoff into a no-op.
   */
  private restore(): void {
    try {
      if (typeof localStorage === 'undefined') return;
      const raw = localStorage.getItem(LOCKOUT_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as PersistedLockout;
      if (typeof parsed.failures === 'number' && parsed.failures >= 0) {
        this.failures = parsed.failures;
      }
      if (typeof parsed.lockedUntil === 'number' && parsed.lockedUntil > 0) {
        this.lockedUntil = parsed.lockedUntil;
      }
    } catch {
      // A corrupt record must never block a legitimate unlock.
    }
  }

  private persist(): void {
    try {
      if (typeof localStorage === 'undefined') return;
      localStorage.setItem(
        LOCKOUT_STORAGE_KEY,
        JSON.stringify({ failures: this.failures, lockedUntil: this.lockedUntil })
      );
    } catch {
      // Storage can be unavailable in private windows; the in-memory policy still applies.
    }
  }

  isLockedOut(now: number): boolean {
    return now < this.lockedUntil;
  }

  remainingMillis(now: number): number {
    return Math.max(0, this.lockedUntil - now);
  }

  onFailure(now: number): number {
    this.failures += 1;
    if (this.failures < this.maxAttempts) {
      this.persist();
      return 0;
    }
    const exponent = Math.min(this.failures - this.maxAttempts, 12);
    const delay = Math.min(this.baseDelayMillis * 2 ** exponent, this.maxDelayMillis);
    this.lockedUntil = now + delay;
    this.persist();
    return delay;
  }

  onSuccess(): void {
    this.failures = 0;
    this.lockedUntil = 0;
    this.persist();
  }
}

interface StoredVerifier {
  salt: string;
  hash: string;
  iterations: number;
}

const VERIFIER_STORAGE_KEY = 'salvia_locked_folder_verifier_v1';
const PBKDF2_ITERATIONS = 120_000;

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function fromBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

async function derivePbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<string> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const saltBuffer = salt.buffer.slice(salt.byteOffset, salt.byteOffset + salt.byteLength) as ArrayBuffer;
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: saltBuffer,
      iterations,
      hash: 'SHA-256',
    },
    keyMaterial,
    256
  );
  return toBase64(new Uint8Array(bits));
}

export function isPasswordConfigured(): boolean {
  return localStorage.getItem(VERIFIER_STORAGE_KEY) !== null;
}

export async function setLockedFolderPassword(password: string): Promise<boolean> {
  if (password.length < MIN_PASSWORD_CHARS) return false;
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  const hash = await derivePbkdf2(password, salt, PBKDF2_ITERATIONS);
  const payload: StoredVerifier = {
    salt: toBase64(salt),
    hash,
    iterations: PBKDF2_ITERATIONS,
  };
  localStorage.setItem(VERIFIER_STORAGE_KEY, JSON.stringify(payload));
  return true;
}

export async function verifyLockedFolderPassword(password: string): Promise<boolean> {
  const raw = localStorage.getItem(VERIFIER_STORAGE_KEY);
  if (!raw) return false;
  try {
    const parsed = JSON.parse(raw) as StoredVerifier;
    const salt = fromBase64(parsed.salt);
    const derived = await derivePbkdf2(password, salt, parsed.iterations || PBKDF2_ITERATIONS);
    return derived === parsed.hash;
  } catch {
    return false;
  }
}

export function removeLockedFolderPassword(): void {
  localStorage.removeItem(VERIFIER_STORAGE_KEY);
}
