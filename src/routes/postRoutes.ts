import { Router } from "express";
import { prisma } from "../lib/prisma.js";

import { requireAuth } from "../middleware/auth.js";

const router = Router();
// Keep existing response fields stable; authorId is managed by the server.
const postFields = { id: true, title: true, content: true, published: true, createdAt: true, updatedAt: true } as const;

router.get("/", async (req, res) => {
    try {
        const posts = await prisma.post.findMany({ select: postFields });

        return res.json(posts);
    } catch (error) {
        console.error("Failed to fetch posts:", error);

        return res.status(500).json({
            message: "Failed to fetch posts"
        });
    }
});

router.get("/:id", async (req, res) => {
    try {
        const id = Number(req.params.id);

        if (!Number.isSafeInteger(id) || id <= 0 || id > 2147483647) {
            return res.status(400).json({
                message: "Invalid post id"
            });
        }

        const post = await prisma.post.findUnique({
            select: postFields,
            where: {
                id
            }
        });

        if (!post) {
            return res.status(404).json({
                message: "Post not found"
            });
        }

        return res.json(post);
    } catch (error) {
        console.error("Failed to fetch post:", error);

        return res.status(500).json({
            message: "Failed to fetch post"
        });
    }
});

router.patch("/:id", requireAuth, async (req, res) => {
    try {
        const id = Number(req.params.id);

        if (!Number.isSafeInteger(id) || id <= 0 || id > 2147483647) {
            return res.status(400).json({
                message: "Invalid post id"
            });
        }

        const { title, content, published } = req.body ?? {};

        if (
            title === undefined &&
            content === undefined &&
            published === undefined
        ) {
            return res.status(400).json({
                message: "At least one field is required"
            });
        }

        if (title !== undefined && (
            typeof title !== "string" ||
            title.trim() === ""
        )) {
            return res.status(400).json({
                message: "Invalid title"
            });
        }

        if (content !== undefined && (
            typeof content !== "string" ||
            content.trim() === ""
        )) {
            return res.status(400).json({
                message: "Invalid content"
            });
        }

        if (published !== undefined && typeof published !== "boolean") {
            return res.status(400).json({
                message: "Invalid published value"
            });
        }

        const existingPost = await prisma.post.findUnique({
            where: {
                id
            }
        });

        if (!existingPost) {
            return res.status(404).json({
                message: "Post not found"
            });
        }

        if (existingPost.authorId !== res.locals.userId) {
            return res.status(403).json({ message: "Only the owner can modify this post" });
        }

        const updatedPost = await prisma.post.update({
            select: postFields,
            where: {
                authorId: res.locals.userId,
                id
            },
            data: {
                ...(title !== undefined && { title: title.trim() }),
                ...(content !== undefined && { content: content.trim() }),
                ...(published !== undefined && { published })
            }
        });

        return res.json(updatedPost);
    } catch (error) {
        console.error("Failed to update post:", error);

        return res.status(500).json({
            message: "Failed to update post"
        });
    }
});

router.post("/", requireAuth, async (req, res) => {
    const userId = res.locals.userId;
    if (userId === undefined) return res.status(401).json({ message: "Authentication required" });
    try {
        const { title, content } = req.body ?? {};

        if (
            typeof title !== "string" ||
            typeof content !== "string" ||
            title.trim() === "" ||
            content.trim() === ""
        ) {
            return res.status(400).json({
                message: "title and content are required"
            });
        }

        const post = await prisma.post.create({
            select: postFields,
            data: {
                title: title.trim(),
                content: content.trim(),
                authorId: userId
            }
        });

        return res.status(201).json(post);
    } catch (error) {
        console.error("Failed to create post:", error);

        return res.status(500).json({
            message: "Failed to create post"
        });
    }
});

router.delete("/:id", requireAuth, async (req, res) => {
    try {
        const id = Number(req.params.id);

        if (!Number.isSafeInteger(id) || id <= 0 || id > 2147483647) {
            return res.status(400).json({
                message: "Invalid post id"
            });
        }

        const existingPost = await prisma.post.findUnique({
            where: {
                id
            }
        });

        if (!existingPost) {
            return res.status(404).json({
                message: "Post not found"
            });
        }

        if (existingPost.authorId !== res.locals.userId) {
            return res.status(403).json({ message: "Only the owner can delete this post" });
        }

        await prisma.post.delete({
            where: {
                authorId: res.locals.userId,
                id
            }
        });

        return res.status(204).send();
    } catch (error) {
        console.error("Failed to delete post:", error);

        return res.status(500).json({
            message: "Failed to delete post"
        });
    }
});

export default router;