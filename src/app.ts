import express from "express";
import postRoutes from "./routes/postRoutes.js";

const app = express();

app.use(express.json());

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

export default app;