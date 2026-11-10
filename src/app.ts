import express, { type ErrorRequestHandler } from "express";
import authRoutes from "./routes/authRoutes.js";
import postRoutes from "./routes/postRoutes.js";

import { fileURLToPath } from 'node:url';
import myPostRoutes from './routes/myPostRoutes.js';

const app = express();
app.use((req, res, next) => {
    res.set({
        'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'same-origin'
    });
    next();
});

app.disable("x-powered-by");
app.use(express.json({ limit: "100kb" }));
app.use("/api/auth", authRoutes);

app.use(express.static(fileURLToPath(new URL("../public/", import.meta.url))));

app.get("/user", (req, res) => {
    res.json({
        name: "sakyo",
        age: 20
    });
});

app.use("/api/posts", postRoutes);
app.use("/api/me/posts", myPostRoutes);

const errorHandler: ErrorRequestHandler = (error: unknown, req, res, next) => {
    if (res.headersSent) { next(error); return; }
    const status = typeof error === 'object' && error !== null && 'status' in error ? error.status : undefined;
    if (status === 400 || status === 413) { res.status(status).json({ message: 'Invalid request body' }); return; }
    res.status(500).json({ message: 'Internal server error' });
};
app.use(errorHandler);
export default app;