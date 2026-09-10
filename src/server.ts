import express from "express";

const app = express();

app.get("/", (req, res) => {
    res.send("Hello Express");
});

app.get("/hello", (req, res) => {
    res.send("Hello API");
});

app.get("/user", (req, res) => {
    res.json({
        name: "sakyo",
        age: 20
    });
});

app.listen(3000, () => {
    console.log("Server Started");
});