import { Router } from "express";
import { prisma } from "../lib/prisma.js";

const router = Router();

router.get("/", async (req, res) => {
    try {
        const posts = await prisma.post.findMany();

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

        if (!Number.isInteger(id) || id <= 0) {
            return res.status(400).json({
                message: "Invalid post id"
            });
        }

        const post = await prisma.post.findUnique({
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

router.patch("/:id", async (req, res) => {
    try {
        const id = Number(req.params.id);

        if (!Number.isInteger(id) || id <= 0) {
            return res.status(400).json({
                message: "Invalid post id"
            });
        }

        const { title, content, published } = req.body;

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

        const updatedPost = await prisma.post.update({
            where: {
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

router.post("/", async (req, res) => {
    try {
        const { title, content } = req.body;

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
            data: {
                title: title.trim(),
                content: content.trim()
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

router.delete("/:id", async (req, res) => {
    try {
        const id = Number(req.params.id);

        if (!Number.isInteger(id) || id <= 0) {
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

        await prisma.post.delete({
            where: {
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