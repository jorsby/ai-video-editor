import { createDecipheriv, createHmac } from 'crypto';

/**
 * Decrypts a value encrypted by Laravel's Crypt::encryptString().
 *
 * Laravel format: base64(JSON({ iv, value, mac, tag }))
 * - iv and value are base64-encoded strings
 * - mac is HMAC-SHA256 of (iv + value) using the APP_KEY
 * - AES-256-CBC with the decoded key and iv
 */
export function decryptLaravel(encryptedValue: string): string {
  const appKey = process.env.MIXPOST_APP_KEY;
  if (!appKey) {
    throw new Error('MIXPOST_APP_KEY is not configured');
  }

  const keyStr = appKey.startsWith('base64:') ? appKey.slice(7) : appKey;
  const key = Buffer.from(keyStr, 'base64');

  const payloadJson = Buffer.from(encryptedValue, 'base64').toString('utf-8');
  const payload: { iv: string; value: string; mac: string; tag: string } =
    JSON.parse(payloadJson);

  // Verify MAC
  const calculatedMac = createHmac('sha256', key)
    .update(payload.iv + payload.value)
    .digest('hex');

  if (calculatedMac !== payload.mac) {
    throw new Error('MAC verification failed — token may be corrupted');
  }

  // Decrypt AES-256-CBC
  const iv = Buffer.from(payload.iv, 'base64');
  const value = Buffer.from(payload.value, 'base64');

  const decipher = createDecipheriv('aes-256-cbc', key, iv);
  let decrypted = decipher.update(value);
  decrypted = Buffer.concat([decrypted, decipher.final()]);

  return decrypted.toString('utf-8');
}
