/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * E2EE for 1-to-1 DMs using Curve25519 (X25519) + XSalsa20-Poly1305.
 * Uses libsodium's crypto_box_easy — the same primitives Signal/WhatsApp use.
 *
 * Private key: kept on-device in localStorage. Never leaves the client.
 * Public key: uploaded to the server so friends can encrypt to you.
 */

import _sodium from 'libsodium-wrappers';
import apiService from './api';
import type { DirectMessageDto } from '../types/api';

const STORAGE_KEY = 'orbital.e2ee.keypair.v1';

let sodiumPromise: Promise<typeof _sodium> | null = null;
async function sodium(): Promise<typeof _sodium> {
  if (!sodiumPromise) {
    sodiumPromise = _sodium.ready.then(() => _sodium);
  }
  return sodiumPromise;
}

interface StoredKeyPair {
  publicKey: string;   // base64
  privateKey: string;  // base64
}

function loadFromStorage(): StoredKeyPair | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredKeyPair;
    if (!parsed.publicKey || !parsed.privateKey) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveToStorage(kp: StoredKeyPair): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(kp));
}

/** Generate a keypair if we don't already have one, and persist it. */
export async function ensureKeyPair(): Promise<StoredKeyPair> {
  const existing = loadFromStorage();
  if (existing) return existing;

  const s = await sodium();
  const kp = s.crypto_box_keypair();
  const stored: StoredKeyPair = {
    publicKey: s.to_base64(kp.publicKey, s.base64_variants.ORIGINAL),
    privateKey: s.to_base64(kp.privateKey, s.base64_variants.ORIGINAL),
  };
  saveToStorage(stored);
  return stored;
}

/** Upload the caller's public key to the server (idempotent). */
export async function syncPublicKeyToServer(): Promise<void> {
  const kp = await ensureKeyPair();
  try {
    const remote = await apiService.getMyPublicKey();
    if (remote === kp.publicKey) return;
  } catch {
    /* fall through — attempt upload anyway */
  }
  await apiService.uploadPublicKey(kp.publicKey);
}

/* ── Public key cache (per-peer, in-memory) ─────────────── */

const publicKeyCache = new Map<string, string>();

export async function getPublicKeyFor(userId: string): Promise<string> {
  const cached = publicKeyCache.get(userId);
  if (cached) return cached;
  const key = await apiService.getUserPublicKey(userId);
  publicKeyCache.set(userId, key);
  return key;
}

export function forgetPublicKeyFor(userId: string): void {
  publicKeyCache.delete(userId);
}

/* ── Encrypt / decrypt ──────────────────────────────────── */

export async function encryptFor(
  peerPublicKeyBase64: string,
  plaintext: string,
): Promise<{ ciphertext: string; nonce: string }> {
  const s = await sodium();
  const kp = await ensureKeyPair();

  const peerPub = s.from_base64(peerPublicKeyBase64, s.base64_variants.ORIGINAL);
  const myPriv = s.from_base64(kp.privateKey, s.base64_variants.ORIGINAL);
  const nonce = s.randombytes_buf(s.crypto_box_NONCEBYTES);
  const message = s.from_string(plaintext);

  const ciphertext = s.crypto_box_easy(message, nonce, peerPub, myPriv);

  return {
    ciphertext: s.to_base64(ciphertext, s.base64_variants.ORIGINAL),
    nonce: s.to_base64(nonce, s.base64_variants.ORIGINAL),
  };
}

/**
 * Decrypt a message. `peerPublicKeyBase64` is the OTHER party's key
 * (sender if received, recipient if sent by you). crypto_box is
 * symmetric — both sides derive the same shared key.
 */
export async function decryptFrom(
  peerPublicKeyBase64: string,
  ciphertextBase64: string,
  nonceBase64: string,
): Promise<string> {
  const s = await sodium();
  const kp = await ensureKeyPair();

  const peerPub = s.from_base64(peerPublicKeyBase64, s.base64_variants.ORIGINAL);
  const myPriv = s.from_base64(kp.privateKey, s.base64_variants.ORIGINAL);
  const nonce = s.from_base64(nonceBase64, s.base64_variants.ORIGINAL);
  const ciphertext = s.from_base64(ciphertextBase64, s.base64_variants.ORIGINAL);

  const plaintext = s.crypto_box_open_easy(ciphertext, nonce, peerPub, myPriv);
  return s.to_string(plaintext);
}

/**
 * Decrypt a full batch. Legacy plaintext rows pass through.
 * Failures become "[Unable to decrypt]" so the chat still renders.
 */
export async function decryptBatch(
  messages: DirectMessageDto[],
  myUserId: string,
): Promise<DirectMessageDto[]> {
  const out: DirectMessageDto[] = [];
  for (const m of messages) {
    if (m.ciphertext && m.nonce) {
      try {
        const peerId = m.senderId === myUserId ? m.recipientId : m.senderId;
        const peerPub = await getPublicKeyFor(peerId);
        const plaintext = await decryptFrom(peerPub, m.ciphertext, m.nonce);
        out.push({ ...m, plaintext });
      } catch (err) {
        console.warn('[E2EE] decrypt failed for msg', m.id, err);
        out.push({ ...m, plaintext: '[Unable to decrypt]' });
      }
    } else {
      out.push({ ...m, plaintext: m.content ?? '' });
    }
  }
  return out;
}

/** Decrypt a single message — used for incoming SignalR events. */
export async function decryptOne(
  msg: DirectMessageDto,
  myUserId: string,
): Promise<DirectMessageDto> {
  if (msg.ciphertext && msg.nonce) {
    try {
      const peerId = msg.senderId === myUserId ? msg.recipientId : msg.senderId;
      const peerPub = await getPublicKeyFor(peerId);
      const plaintext = await decryptFrom(peerPub, msg.ciphertext, msg.nonce);
      return { ...msg, plaintext };
    } catch {
      return { ...msg, plaintext: '[Unable to decrypt]' };
    }
  }
  return { ...msg, plaintext: msg.content ?? '' };
}