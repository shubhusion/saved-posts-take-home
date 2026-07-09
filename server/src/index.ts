import { createApp } from "./app";
import { createDb } from "./db/client";

const app = createApp(createDb());
const port = Number(process.env.PORT ?? 3001);
app.listen(port);

console.log(`API listening on http://localhost:${port}`);
