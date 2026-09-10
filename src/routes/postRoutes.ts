import { Router } from "express";

const router = Router();

router.get("/", (req, res) => {
    res.json([
        {
            id: 1,
            title: "My first post",
            content: "Hello Blog!"
        }
    ]);
});

router.post("/", (req, res) => {
    const { title, content } = req.body;

    res.status(201).json({
        id: 2,
        title,
        content
    });
});

export default router;