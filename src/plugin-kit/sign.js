import { createPrivateKey, createPublicKey, generateKeyPairSync, sign as nodeSign, verify as nodeVerify } from 'node:crypto';
import { canonicalText, readSignature } from '../runtime/meta.js';
import { withSignature } from './header.js';

/**
 * Signing built plugin files, and checking those signatures. Ed25519, because the signature is short
 * enough to sit on one line of a metadata header and the page can verify it with WebCrypto.
 *
 * A signature says "this file is exactly what the holder of this key signed". It says nothing about
 * what the code does. What a client app *means* by a given key — reviewed, first-party, internal — is
 * the client app's decision, which is why keys are configured there and not here.
 *
 * The bytes signed are `canonicalText()`, which is frozen; see docs/plugin-development.md.
 */
export const ALGORITHM = 'ed25519';

/** A new signing key pair, as base64 DER: public SPKI (shareable) and private PKCS#8 (secret). */
export function generateKeys() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    publicKey: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
    privateKey: privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'),
  };
}

function privateKeyFrom(value) {
  const text = String(value).trim();
  if (text.includes('BEGIN')) return createPrivateKey(text);
  return createPrivateKey({ key: Buffer.from(text, 'base64'), type: 'pkcs8', format: 'der' });
}

function publicKeyFrom(value) {
  const text = String(value).trim();
  if (text.includes('BEGIN')) return createPublicKey(text);
  return createPublicKey({ key: Buffer.from(text, 'base64'), type: 'spki', format: 'der' });
}

/** Signs a built plugin file's text, returning the text with its `@signature` line in place. */
export function signText(text, { keyId, privateKey }) {
  if (!keyId || /\s/.test(keyId)) throw new Error('keyId must be a word, with no spaces (it names the key in a client app\'s trust list)');
  const value = nodeSign(null, Buffer.from(canonicalText(text), 'utf8'), privateKeyFrom(privateKey)).toString('base64');
  return withSignature(text, { algorithm: ALGORITHM, keyId, value });
}

/**
 * Checks a signed file against one or more public keys: `{ keyId: publicKey }`.
 * Returns { state, keyId }, where state is:
 *   'unsigned'  no @signature line
 *   'malformed' there is one, but it can't be read
 *   'unknown'   signed by a key that isn't in `keys`
 *   'valid'     signed by a key in `keys`, and the bytes match
 *   'tampered'  signed by a key in `keys`, but the bytes do not match — do not run this
 */
export function verifyText(text, keys = {}) {
  const signature = readSignature(text);
  if (!signature) return { state: /@signature\b/.test(text) ? 'malformed' : 'unsigned', keyId: null };
  if (signature.algorithm !== ALGORITHM) return { state: 'malformed', keyId: signature.keyId };
  const key = keys[signature.keyId];
  if (!key) return { state: 'unknown', keyId: signature.keyId };
  let ok = false;
  try {
    ok = nodeVerify(null, Buffer.from(signature.canonical, 'utf8'), publicKeyFrom(key), Buffer.from(signature.value, 'base64'));
  } catch {
    ok = false;
  }
  return { state: ok ? 'valid' : 'tampered', keyId: signature.keyId };
}
