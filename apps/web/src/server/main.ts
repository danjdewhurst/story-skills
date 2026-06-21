import { createApiServer } from "./api";

const server = createApiServer();
console.log(`Story Skills Studio API listening on http://127.0.0.1:${server.port}`);
