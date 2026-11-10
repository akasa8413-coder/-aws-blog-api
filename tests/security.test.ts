import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { SignJWT } from 'jose';
import { hashPassword, verifyPassword } from '../src/lib/password.js';
import { issueToken, verifyToken, validateAuthConfig } from '../src/lib/token.js';

process.env.JWT_SECRET = randomBytes(48).toString('hex');
const key = new TextEncoder().encode(process.env.JWT_SECRET);

test('password hashes are salted, verifiable, and reject wrong passwords or malformed hashes', async () => {
    const password = 'correct password 日本語';
    const a = await hashPassword(password);
    const b = await hashPassword(password);
    assert.notEqual(a, b);
    assert.equal(a.includes(password), false);
    assert.equal(await verifyPassword(password, a), true);
    assert.equal(await verifyPassword('wrong password', a), false);
    for (const malformed of ['', 'scrypt-v1$bad$bad', `${a}$extra`, a.replace('scrypt-v1', 'other')]) {
        assert.equal(await verifyPassword(password, malformed), false);
    }
});
test('JWT verifies a signed subject and rejects tampering', async () => {
    const token = await issueToken(42);
    assert.equal(await verifyToken(token), 42);
    const parts = token.split('.');
    parts[1] = Buffer.from(JSON.stringify({ sub: '43' })).toString('base64url');
    await assert.rejects(verifyToken(parts.join('.')));
    await assert.rejects(verifyToken('not-a-token'));
});
test('JWT rejects expiration, wrong issuer/audience/key/algorithm, missing claims and invalid IDs', async () => {
    const cases: Array<{ alg?: string; iss?: string; aud?: string; sub?: string; exp?: number; missing?: boolean; wrongKey?: boolean }> = [
        { exp: Math.floor(Date.now() / 1000) - 1 }, { iss: 'other' }, { aud: 'other' },
        { sub: '0' }, { sub: '1.5' }, { sub: '2147483648' }, { sub: '-1' }, { sub: '01' },
        { missing: true }, { alg: 'HS384' }, { wrongKey: true }
    ];
    for (const item of cases) {
        let jwt = new SignJWT({}).setProtectedHeader({ alg: item.alg ?? 'HS256', typ: 'JWT' })
            .setSubject(item.sub ?? '1').setIssuer(item.iss ?? 'aws-blog-api')
            .setAudience(item.aud ?? 'aws-blog-api-client').setIssuedAt();
        if (!item.missing) jwt = jwt.setExpirationTime(item.exp ?? '1h');
        const token = await jwt.sign(item.wrongKey ? randomBytes(48) : key);
        await assert.rejects(verifyToken(token), JSON.stringify(item));
    }
    await assert.rejects(verifyToken(`${Buffer.from('{"alg":"none"}').toString('base64url')}.e30.`));
});
test('JWT config fails closed when secret is absent or too short', () => {
    const previous = process.env.JWT_SECRET;
    try {
        delete process.env.JWT_SECRET;
        assert.throws(validateAuthConfig);
        process.env.JWT_SECRET = 'short';
        assert.throws(validateAuthConfig);
    } finally { process.env.JWT_SECRET = previous; }
});
