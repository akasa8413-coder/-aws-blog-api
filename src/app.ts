import express, { type ErrorRequestHandler } from "express";
import authRoutes from "./routes/authRoutes.js";
import postRoutes from "./routes/postRoutes.js";

const app = express();

app.disable("x-powered-by");
app.use(express.json({ limit: "100kb" }));
app.use("/api/auth", authRoutes);

app.get("/", (req, res) => {
    res.send("Hello Express");
});

app.get("/user", (req, res) => {
    res.json({
        name: "sakyo",
        age: 20
    });
});

app.use("/api/posts", postRoutes);

const errorHandler: ErrorRequestHandler = (error: unknown, req, res, next) => {
    if (res.headersSent) { next(error); return; }
    const status = typeof error === 'object' && error !== null && 'status' in error ? error.status : undefined;
    if (status === 400 || status === 413) { res.status(status).json({ message: 'Invalid request body' }); return; }
    res.status(500).json({ message: 'Internal server error' });
};
app.use(errorHandler);
export default app;