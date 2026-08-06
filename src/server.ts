import "dotenv/config";
import express, {
    type NextFunction,
    type Request,
    type Response,
} from "express";

const app = express();

const port = Number(process.env.PORT ?? 3000);

app.use(express.json());

app.get("/health", (_request: Request, response: Response) => {
    response.status(200).json({
        status: "ok",
    });
});

app.use((_request: Request, response: Response) => {
    response.status(404).json({
        message: "Route not found",
    });
});

app.use(
    (
        error: unknown,
        _request: Request,
        response: Response,
        _next: NextFunction,
    ) => {
        console.error(error);

        response.status(500).json({
            message: "Internal server error",
        });
    },
);

app.listen(port, () => {
    console.log(`Server is running at http://localhost:${port}`);
});