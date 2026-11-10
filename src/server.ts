import app from "./app.js";

import { validateAuthConfig } from "./lib/token.js";

validateAuthConfig();

const PORT = 3000;

app.listen(PORT, () => {
    console.log(`Server started on http://localhost:${PORT}`);
});