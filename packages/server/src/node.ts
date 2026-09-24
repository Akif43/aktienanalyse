import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * Setzt einen Web-Standard-Handler auf die Node-Schnittstelle (req, res) um. Das ist die Signatur, die
 * Vercel-Funktionen und der Vite-Dev-Server gemeinsam verstehen.
 */
export function toNodeHandler(handler: (req: Request) => Promise<Response>) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const host = req.headers.host ?? 'localhost';
    const proto = (req.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0] ?? 'http';
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
      if (typeof v === 'string') headers.set(k, v);
      else if (Array.isArray(v)) headers.set(k, v.join(', '));
    }
    const method = req.method ?? 'GET';
    // GET/HEAD dürfen im Web-Standard-Request keinen Body haben; alle anderen Methoden puffern ihn (die
    // Anfragen hier sind klein, JSON-Regeln, kein Streaming nötig).
    let body: Buffer | undefined;
    if (method !== 'GET' && method !== 'HEAD') {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      body = Buffer.concat(chunks);
    }
    let response: Response;
    try {
      response = await handler(new Request(`${proto}://${host}${req.url ?? '/'}`, { method, headers, body: body as BodyInit | undefined }));
    } catch (err) {
      console.error('Handler-Fehler', err);
      response = new Response(JSON.stringify({ error: { code: 'INTERNAL', message: 'Interner Fehler' } }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      });
    }
    res.statusCode = response.status;
    response.headers.forEach((value, key) => res.setHeader(key, value));
    res.end(Buffer.from(await response.arrayBuffer()));
  };
}
