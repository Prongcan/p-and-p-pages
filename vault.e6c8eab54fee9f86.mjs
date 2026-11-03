// P&P encrypted snapshot format v1. Keys and plaintext stay in this tab's memory.
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function decode(value, length) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid encoding');
  const bytes = Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
  if (bytes.length !== length) throw new Error('Invalid length');
  return bytes;
}

export async function readCipher(path) {
  const response = await fetch(path, { cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' });
  if (!response.ok) throw new Error('Unable to download encrypted content');
  return new Uint8Array(await response.arrayBuffer());
}

export async function decryptRecord(key, record, read = readCipher) {
  if (!record || !/^[a-f0-9]{32}$/.test(record.id)) throw new Error('Invalid record');
  return new Uint8Array(await crypto.subtle.decrypt({
    name: 'AES-GCM', iv: decode(record.iv, 12), tagLength: 128,
    additionalData: encoder.encode('P&P:sealed:v1:' + record.id)
  }, key, await read('sealed/' + record.id + '.bin')));
}

export async function unlockVault(password, manifest, read = readCipher) {
  if (!manifest || manifest.version !== 1 || manifest.kdf?.name !== 'PBKDF2'
      || manifest.kdf.hash !== 'SHA-256' || manifest.kdf.iterations !== 600000) throw new Error('Unsupported snapshot');
  if (!crypto?.subtle) throw new Error('This browser needs HTTPS and Web Crypto');
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', iterations: 600000,
    salt: decode(manifest.kdf.salt, 32) }, material, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  const plain = await decryptRecord(key, manifest.vault, read);
  let data;
  try { data = JSON.parse(decoder.decode(plain)); } finally { plain.fill(0); }
  if (data.version !== 1 || !data.site || !Array.isArray(data.moments) || !data.media) throw new Error('Invalid snapshot');
  return { key, data };
}
