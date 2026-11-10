import 'dotenv/config';
import { SignJWT, jwtVerify } from 'jose';

const issuer = 'aws-blog-api';
const audience = 'aws-blog-api-client';
function secret(): Uint8Array {
    const value = process.env.JWT_SECRET;
    if (!value || Buffer.byteLength(value) < 32 || value === 'replace-with-a-random-secret-at-least-32-bytes') {
        throw new Error('JWT_SECRET must contain at least 32 bytes of random secret material');
    }
    return new TextEncoder().encode(value);
}
export function validateAuthConfig(): void { secret(); }
export async function issueToken(userId: number): Promise<string> {
    return new SignJWT({}).setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
        .setSubject(String(userId)).setIssuer(issuer).setAudience(audience)
        .setIssuedAt().setExpirationTime('1h').sign(secret());
}
export async function verifyToken(token: string): Promise<number> {
    const { payload } = await jwtVerify(token, secret(), {
        algorithms: ['HS256'], issuer, audience, typ: 'JWT', requiredClaims: ['sub', 'iat', 'exp'], maxTokenAge: '1h'
    });
    if (!payload.sub || !/^[1-9]\d*$/.test(payload.sub)) throw new Error('Invalid subject');
    const id = Number(payload.sub);
    if (!Number.isSafeInteger(id) || id > 2147483647) throw new Error('Invalid subject');
    return id;
}
