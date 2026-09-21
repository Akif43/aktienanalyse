import { createApi, toNodeHandler } from '@aktien/server';

// Vercel-Funktion. Die Route wird aus dem Pfad (/api/<name>) abgeleitet, siehe packages/server/src/api.ts.
export default toNodeHandler(createApi(process.env));
