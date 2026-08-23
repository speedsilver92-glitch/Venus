const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBase64(bytes) {
  let binary = '';
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

function fromBase64(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

async function deriveKey(passphrase, salt, usage = ['encrypt', 'decrypt']) {
  const material = await crypto.subtle.importKey(
    'raw', encoder.encode(passphrase), 'PBKDF2', false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 250000, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    usage
  );
}

export async function encryptText(passphrase, text) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt);
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(text));
  return {
    content: toBase64(new Uint8Array(encrypted)),
    crypto: { alg: 'AES-GCM', kdf: 'PBKDF2-SHA256', iterations: 250000, salt: toBase64(salt), iv: toBase64(iv) }
  };
}

export async function decryptText(passphrase, content, meta) {
  try {
    const salt = fromBase64(meta.salt);
    const iv = fromBase64(meta.iv);
    const key = await deriveKey(passphrase, salt);
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, fromBase64(content));
    return decoder.decode(decrypted);
  } catch {
    throw new Error('Wrong room code or damaged encrypted message.');
  }
}

export async function encryptFile(passphrase, file) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt);
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, await file.arrayBuffer());
  return {
    blob: new Blob([encrypted], { type: 'application/octet-stream' }),
    meta: {
      encrypted: true,
      originalName: file.name,
      originalType: file.type || 'application/octet-stream',
      originalSize: file.size,
      crypto: { alg: 'AES-GCM', kdf: 'PBKDF2-SHA256', iterations: 250000, salt: toBase64(salt), iv: toBase64(iv) }
    }
  };
}

export async function decryptFile(passphrase, arrayBuffer, meta) {
  const salt = fromBase64(meta.crypto.salt);
  const iv = fromBase64(meta.crypto.iv);
  const key = await deriveKey(passphrase, salt);
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, arrayBuffer);
  return new Blob([decrypted], { type: meta.originalType || 'application/octet-stream' });
}

export async function hashLocalPin(pin) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(`privora-local-lock:${pin}`));
  return toBase64(new Uint8Array(digest));
}
