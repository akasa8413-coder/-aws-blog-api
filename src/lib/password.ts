import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

function derive(password: string, salt: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        scrypt(password, salt, 64, { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 },
            (error, key) => error ? reject(error) : resolve(key));
    });
}
export async function hashPassword(password: string): Promise<string> {
    const salt = randomBytes(16).toString('hex');
    return `scrypt-v1$${salt}$${(await derive(password, salt)).toString('hex')}`;
}
export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
    const parts = encoded.split('$');
    const [version, salt, hash] = parts;
    if (parts.length !== 3 || version !== 'scrypt-v1' || !salt || !hash ||
        !/^[a-f0-9]{32}$/.test(salt) || !/^[a-f0-9]{128}$/.test(hash)) return false;
    return timingSafeEqual(await derive(password, salt), Buffer.from(hash, 'hex'));
}
