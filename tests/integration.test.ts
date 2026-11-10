import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import pg from 'pg';

// Never fall back to the developer's DATABASE_URL or .env database.
const url = process.env.TEST_DATABASE_URL;
if (!url || new URL(url).pathname !== '/auth_test') {
    throw new Error('Set TEST_DATABASE_URL to the isolated auth_test database; developer DBs are forbidden');
}
process.env.DATABASE_URL = url;
process.env.JWT_SECRET = randomBytes(48).toString('hex');

test('migrations and authentication API against isolated PostgreSQL', async (t) => {
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    const { default: app } = await import('../src/app.js');
    const { prisma } = await import('../src/lib/prisma.js');
    const { issueToken } = await import('../src/lib/token.js');
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}`;
    async function request(method: string, path: string, body?: unknown, token?: string) {
        return fetch(base + path, { method, headers: {
            ...(body !== undefined && { 'Content-Type': 'application/json' }),
            ...(token && { Authorization: `Bearer ${token}` })
        }, ...(body !== undefined && { body: JSON.stringify(body) }) });
    }
    try {
        await t.test('upgrade preserves existing posts with no assigned owner', async () => {
            await client.query('BEGIN');
            try {
                await client.query('CREATE SCHEMA migration_test');
                await client.query('SET LOCAL search_path TO migration_test');
                await client.query(await readFile(new URL('../prisma/migrations/20261006075458_init/migration.sql', import.meta.url), 'utf8'));
                await client.query(`INSERT INTO "Post" (title,content,"updatedAt") VALUES ('legacy','kept',NOW())`);
                await client.query(await readFile(new URL('../prisma/migrations/20261110020000_add_users/migration.sql', import.meta.url), 'utf8'));
                const result = await client.query('SELECT title, content, "authorId" FROM "Post"');
                assert.deepEqual(result.rows, [{ title: 'legacy', content: 'kept', authorId: null }]);
            } finally { await client.query('ROLLBACK'); }
        });
        // The database is dedicated to these tests, not a developer database.
        await client.query('TRUNCATE "Post", "User" RESTART IDENTITY CASCADE');
        const password = 'a strong password 123';
        let ownerId = 0, ownerToken = '', otherToken = '', postId = 0;
        await t.test('register normalizes email, hides hashes, handles duplicates and validates input', async () => {
            const result = await request('POST', '/api/auth/register', { name: ' Owner ', email: ' Owner@Example.com ', password });
            assert.equal(result.status, 201);
            const data = await result.json();
            ownerId = data.user.id;
            assert.equal(data.user.email, 'owner@example.com');
            assert.equal(data.user.name, 'Owner');
            assert.equal('passwordHash' in data.user, false);
            const stored = await prisma.user.findUniqueOrThrow({ where: { id: ownerId } });
            assert.notEqual(stored.passwordHash, password);
            assert.ok(stored.passwordHash.startsWith('scrypt-v1$'));
            assert.equal((await request('POST', '/api/auth/register', { name: 'Duplicate', email: 'OWNER@example.com', password })).status, 409);
            for (const body of [null, [], {}, { name: 'A', email: 'invalid', password },
                { name: 'A', email: 'a@b.com', password: 'short' },
                { name: 'A', email: 'a@b.com', password: 'あ'.repeat(50) }]) {
                assert.equal((await request('POST', '/api/auth/register', body)).status, 400);
            }
            assert.equal((await request('POST', '/api/auth/register', { name: 'Other', email: 'other@example.com', password })).status, 201);
        });
        await t.test('login returns tokens, hides hashes, and rejects incorrect credentials', async () => {
            for (const [email, pass] of [['owner@example.com', 'incorrect password'], ['unknown@example.com', password]]) {
                const response = await request('POST', '/api/auth/login', { email, password: pass });
                assert.equal(response.status, 401);
                assert.deepEqual(await response.json(), { message: 'Invalid email or password' });
            }
            assert.equal((await request('POST', '/api/auth/login', {})).status, 400);
            const response = await request('POST', '/api/auth/login', { email: 'OWNER@example.com', password });
            assert.equal(response.status, 200);
            const data = await response.json();
            ownerToken = data.accessToken;
            assert.equal(data.expiresIn, 3600);
            assert.equal('passwordHash' in data.user, false);
            otherToken = (await (await request('POST', '/api/auth/login', { email: 'other@example.com', password })).json()).accessToken;
        });
        await t.test('writes require a valid token and an existing user', async () => {
            for (const token of [undefined, 'bad-token', await issueToken(2147483647)]) {
                assert.equal((await request('POST', '/api/posts', { title: 'T', content: 'C' }, token)).status, 401);
            }
            const badHeader = await fetch(base + '/api/posts', { method: 'POST', headers: { Authorization: 'Basic abc' } });
            assert.equal(badHeader.status, 401);
        });
        await t.test('create binds the authenticated owner and preserves post response fields', async () => {
            const response = await request('POST', '/api/posts', { title: ' T ', content: ' C ', authorId: ownerId + 1 }, ownerToken);
            assert.equal(response.status, 201);
            const post = await response.json();
            postId = post.id;
            assert.deepEqual(Object.keys(post).sort(), ['id','title','content','published','createdAt','updatedAt'].sort());
            assert.equal(post.title, 'T');
            assert.equal(post.published, false);
            assert.equal((await prisma.post.findUniqueOrThrow({ where: { id: postId } })).authorId, ownerId);
            assert.equal((await request('POST', '/api/posts', null, ownerToken)).status, 400);
        });
        await t.test('public reads retain current behavior including unpublished posts', async () => {
            const list = await request('GET', '/api/posts');
            assert.equal(list.status, 200);
            assert.equal((await list.json()).length, 1);
            assert.equal((await request('GET', `/api/posts/${postId}`)).status, 200);
            assert.equal((await request('GET', '/api/posts/2147483648')).status, 400);
            assert.equal((await request('GET', '/api/posts/99999')).status, 404);
        });
        await t.test('only the owner can update or delete; input cannot transfer ownership', async () => {
            assert.equal((await request('PATCH', `/api/posts/${postId}`, { title: 'stolen' }, otherToken)).status, 403);
            assert.equal((await request('DELETE', `/api/posts/${postId}`, undefined, otherToken)).status, 403);
            assert.equal((await request('PATCH', `/api/posts/${postId}`, { published: 'true' }, ownerToken)).status, 400);
            assert.equal((await request('PATCH', `/api/posts/${postId}`, {}, ownerToken)).status, 400);
            const updated = await request('PATCH', `/api/posts/${postId}`, { title: 'New', published: true, authorId: ownerId + 1 }, ownerToken);
            assert.equal(updated.status, 200);
            assert.equal((await updated.json()).published, true);
            assert.equal((await prisma.post.findUniqueOrThrow({ where: { id: postId } })).authorId, ownerId);
            assert.equal((await request('PATCH', '/api/posts/99999', { title: 'Missing' }, ownerToken)).status, 404);
            assert.equal((await request('DELETE', `/api/posts/${postId}`, undefined, ownerToken)).status, 204);
            assert.equal((await request('GET', `/api/posts/${postId}`)).status, 404);
        });
        await t.test('legacy posts remain readable but cannot be claimed or modified', async () => {
            const legacy = await prisma.post.create({ data: { title: 'Legacy', content: 'Kept' } });
            assert.equal((await request('GET', `/api/posts/${legacy.id}`)).status, 200);
            assert.equal((await request('PATCH', `/api/posts/${legacy.id}`, { title: 'Claim', authorId: ownerId }, ownerToken)).status, 403);
            assert.equal((await request('DELETE', `/api/posts/${legacy.id}`, undefined, ownerToken)).status, 403);
        });
        await t.test('JSON errors and oversized bodies return safe client errors', async () => {
            const malformed = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' });
            assert.equal(malformed.status, 400);
            const oversized = await request('POST', '/api/auth/login', { padding: 'x'.repeat(110_000) });
            assert.equal(oversized.status, 413);
        });
        await t.test('database constraints prevent orphan ownership and deleting an owner', async () => {
            await assert.rejects(prisma.post.create({ data: { title: 'Bad', content: 'Bad', authorId: 2147483647 } }));
            await prisma.post.create({ data: { title: 'Owned', content: 'Kept', authorId: ownerId } });
            await assert.rejects(prisma.user.delete({ where: { id: ownerId } }));
        });
        await t.test('authentication throttles excessive attempts', async () => {
            let limited: Response | undefined;
            for (let i = 0; i < 31; i++) {
                const response = await request('POST', '/api/auth/login', {});
                if (response.status === 429) { limited = response; break; }
                assert.equal(response.status, 400);
            }
            assert.ok(limited);
            assert.equal(limited.headers.get('retry-after'), '60');
        });
    } finally {
        await new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections(); });
        await prisma.$disconnect();
        await client.end();
    }
});
