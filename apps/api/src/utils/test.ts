import test from 'node:test';
import assert from 'node:assert';
import { encrypt, decrypt } from './encryption.js';
import { signJwt, verifyJwt } from './jwt.js';

test('Encryption Utility Tests', async (t) => {
  await t.test('should encrypt and decrypt a message successfully', () => {
    const originalMessage = 'super-secret-github-token-12345';
    const encrypted = encrypt(originalMessage);
    
    assert.notStrictEqual(encrypted, originalMessage);
    assert.strictEqual(encrypted.split(':').length, 3); // Format: iv:tag:cipher
    
    const decrypted = decrypt(encrypted);
    assert.strictEqual(decrypted, originalMessage);
  });

  await t.test('should fail decrypting malformed inputs', () => {
    assert.throws(() => {
      decrypt('invalid-format-message');
    }, /Invalid encrypted text format/);

    assert.throws(() => {
      decrypt('iv:tag:cipher:extra');
    }, /Invalid encrypted text format/);
  });
});

test('JWT Utility Tests', async (t) => {
  const userPayload = {
    userId: 'user-uuid-123',
    email: 'test@portway.dev',
    teamId: 'team-uuid-456',
    role: 'owner',
  };

  await t.test('should sign and verify JWT successfully', () => {
    const token = signJwt(userPayload);
    assert.strictEqual(token.split('.').length, 3);

    const decoded = verifyJwt(token);
    assert.strictEqual(decoded.userId, userPayload.userId);
    assert.strictEqual(decoded.email, userPayload.email);
    assert.strictEqual(decoded.teamId, userPayload.teamId);
    assert.strictEqual(decoded.role, userPayload.role);
    assert.ok(decoded.exp > Math.floor(Date.now() / 1000));
  });

  await t.test('should fail verify for expired token', () => {
    // Generate a token that expired 10 seconds ago
    const token = signJwt(userPayload, -10);
    
    assert.throws(() => {
      verifyJwt(token);
    }, /JWT has expired/);
  });

  await t.test('should fail verify for invalid signature', () => {
    const token = signJwt(userPayload);
    const alteredToken = token.substring(0, token.length - 5) + 'xxxxx';
    
    assert.throws(() => {
      verifyJwt(alteredToken);
    }, /Invalid JWT signature/);
  });
});
