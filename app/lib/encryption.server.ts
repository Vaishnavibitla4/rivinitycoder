import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto';

// Derive a consistent 32-byte key from the env variable (or a default for dev)
function getKey(): Buffer {
  const secret = process.env.DB_ENCRYPTION_KEY || 'default-dev-secret-change-in-prod';

  // SHA-256 of the secret gives us a stable 32-byte key for AES-256
  return createHash('sha256').update(secret).digest();
}

const ALGORITHM = 'aes-256-cbc';
const IV_LENGTH = 16; // AES block size

export function encryptField(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);

  // Store as iv_hex:ciphertext_base64
  return iv.toString('hex') + ':' + encrypted.toString('base64');
}

export function decryptField(payload: string): string {
  const key = getKey();
  const [ivHex, ciphertextBase64] = payload.split(':');

  if (!ivHex || !ciphertextBase64) {
    throw new Error('Invalid encrypted payload format');
  }

  const iv = Buffer.from(ivHex, 'hex');
  const ciphertext = Buffer.from(ciphertextBase64, 'base64');
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

  return decrypted.toString('utf8');
}

export function safeDecryptField(payload: string | null | undefined): string | null {
  if (payload == null) {
    return null;
  }

  try {
    return decryptField(payload);
  } catch {
    return payload;
  }
}
