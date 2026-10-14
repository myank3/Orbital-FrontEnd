/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * TEMPORARY PASSTHROUGH.
 *
 * The real E2EE implementation used libsodium Curve25519 + XSalsa20-Poly1305.
 * It has been replaced with a plaintext passthrough to unblock messaging
 * while we redesign multi-device support.
 *
 * The wire format is unchanged: messages still travel in `ciphertext` and
 * `nonce` fields. They just contain plaintext now.
 *
 * TODO: restore real crypto once multi-device key architecture is in place.
 */

import type { DirectMessageDto } from '../types/api';

const STORAGE_KEY = 'orbital.e2ee.keypair.v1';

export interface StoredKeyPair {
  publicKey: string;
  privateKey: string;
}

export async function ensureKeyPair(): Promise<StoredKeyPair> {
  const existing = localStorage.getItem(STORAGE_KEY);
  if (existing) {
    try {
      const parsed = JSON.parse(existing) as StoredKeyPair;
      if (parsed.publicKey && parsed.privateKey) return parsed;
    } catch {
      /* fall through */
    }
  }
  const stub: StoredKeyPair = {
    publicKey: 'PLAINTEXT-PASSTHROUGH',
    privateKey: 'PLAINTEXT-PASSTHROUGH',
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(stub));
  return stub;
}

export async function syncPublicKeyToServer(): Promise<void> {
  /* no-op while in passthrough mode */
}

export async function getPublicKeyFor(_userId: string): Promise<string> {
  return 'PLAINTEXT-PASSTHROUGH';
}

export function forgetPublicKeyFor(_userId: string): void {
  /* no-op */
}

export async function encryptFor(
  _peerPublicKeyBase64: string,
  plaintext: string,
): Promise<{ ciphertext: string; nonce: string }> {
  return { ciphertext: plaintext, nonce: 'PLAINTEXT' };
}

export async function decryptFrom(
  _peerPublicKeyBase64: string,
  ciphertextBase64: string,
  _nonceBase64: string,
): Promise<string> {
  return ciphertextBase64;
}

export async function decryptBatch(
  messages: DirectMessageDto[],
  _myUserId: string,
): Promise<DirectMessageDto[]> {
  return messages.map((m) => ({
    ...m,
    plaintext: m.ciphertext ?? m.content ?? '',
  }));
}

export async function decryptOne(
  msg: DirectMessageDto,
  _myUserId: string,
): Promise<DirectMessageDto> {
  return { ...msg, plaintext: msg.ciphertext ?? msg.content ?? '' };
}