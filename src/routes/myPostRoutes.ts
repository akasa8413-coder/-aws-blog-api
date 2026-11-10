import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);
router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
const fields = { id: true, title: true, content: true, published: true, createdAt: true, updatedAt: true } as const;
router.get('/', async (req, res, next) => {
    try {
        res.json(await prisma.post.findMany({
            where: { authorId: res.locals.userId }, select: fields,
            orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }]
        }));
    } catch (error) { next(error); }
});
router.get('/:id', async (req, res, next) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0 || id > 2147483647) {
        res.status(400).json({ message: 'Invalid post id' }); return;
    }
    try {
        const post = await prisma.post.findFirst({ where: { id, authorId: res.locals.userId }, select: fields });
        if (!post) { res.status(404).json({ message: 'Post not found' }); return; }
        res.json(post);
    } catch (error) { next(error); }
});
export default router;
