import type { RequestHandler } from 'express';
import { verifyToken } from '../lib/token.js';
import { prisma } from '../lib/prisma.js';

declare global {
    namespace Express {
        interface Locals { userId?: number; }
    }
}
export const requireAuth: RequestHandler = async (req, res, next) => {
    const match = /^Bearer ([^\s]+)$/i.exec(req.get('authorization') ?? '');
    if (!match?.[1]) { res.status(401).json({ message: 'Authentication required' }); return; }
    let id: number;
    try { id = await verifyToken(match[1]); }
    catch { res.status(401).json({ message: 'Invalid or expired token' }); return; }
    try {
        const user = await prisma.user.findUnique({ where: { id }, select: { id: true } });
        if (!user) { res.status(401).json({ message: 'Invalid or expired token' }); return; }
        res.locals.userId = id;
        next();
    } catch (error) { next(error); }
};
