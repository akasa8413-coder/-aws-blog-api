import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { prisma } from '../lib/prisma.js';
import { Prisma } from '../generated/prisma/client.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import { issueToken } from '../lib/token.js';

const router = Router();
const publicUser = { id: true, name: true, email: true, createdAt: true, updatedAt: true } as const;
const dummyHash = hashPassword('dummy-password-never-used-for-login');
function credentials(body: unknown): { email: string; password: string } | null {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
    const { email, password } = body as Record<string, unknown>;
    if (typeof email !== 'string' || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ||
        typeof password !== 'string' || password.length < 12 || Buffer.byteLength(password) > 128) return null;
    return { email: email.trim().toLowerCase(), password };
}
router.get('/me', requireAuth, async (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    try {
        const user = await prisma.user.findUnique({ where: { id: res.locals.userId }, select: publicUser });
        if (!user) { res.status(401).json({ message: 'Authentication required' }); return; }
        res.json({ user });
    } catch (error) { next(error); }
});
// Bound costly password work within this process. Use a shared limiter when deploying multiple replicas.
let active = 0;
let budget = 30;
let resetAt = Date.now() + 60_000;
router.use((req, res, next) => {
    res.set("Cache-Control", "no-store");
    if (Date.now() >= resetAt) { budget = 30; resetAt = Date.now() + 60_000; }
    if (budget <= 0 || active >= 4) {
        res.set('Retry-After', '60').status(429).json({ message: 'Too many authentication requests' }); return;
    }
    budget--; active++;
    res.once('finish', () => { active--; });
    next();
});
router.post('/register', async (req, res, next) => {
    const data = credentials(req.body);
    const name: unknown = req.body?.name;
    if (!data || typeof name !== 'string' || !name.trim() || name.trim().length > 100) {
        res.status(400).json({ message: 'Valid name, email and password (at least 12 characters, at most 128 bytes) are required' }); return;
    }
    try {
        const user = await prisma.user.create({
            data: {
                name: name.trim(), email: data.email,
                passwordHash: await hashPassword(data.password)
            }, select: publicUser
        });
        res.status(201).json({ user });
    } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
            res.status(409).json({ message: 'Email already registered' }); return;
        }
        next(error);
    }
});
router.post('/login', async (req, res, next) => {
    const data = credentials(req.body);
    if (!data) { res.status(400).json({ message: 'Valid email and password are required' }); return; }
    try {
        const user = await prisma.user.findUnique({ where: { email: data.email } });
        const valid = await verifyPassword(data.password, user?.passwordHash ?? await dummyHash);
        if (!user || !valid) { res.status(401).json({ message: 'Invalid email or password' }); return; }
        const safeUser = { id: user.id, name: user.name, email: user.email, createdAt: user.createdAt, updatedAt: user.updatedAt };
        res.json({ user: safeUser, accessToken: await issueToken(user.id), tokenType: 'Bearer', expiresIn: 3600 });
    } catch (error) { next(error); }
});
export default router;
