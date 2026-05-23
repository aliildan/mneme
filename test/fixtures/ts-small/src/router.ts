import { AuthService } from "./auth.js";

type Handler = (req: Request) => Response | Promise<Response>;

export class Router {
  private routes: Map<string, Handler> = new Map();
  private auth: AuthService;

  constructor(auth: AuthService) {
    this.auth = auth;
  }

  get(path: string, handler: Handler): this {
    this.routes.set(`GET:${path}`, handler);
    return this;
  }

  post(path: string, handler: Handler): this {
    this.routes.set(`POST:${path}`, handler);
    return this;
  }

  async dispatch(method: string, path: string): Promise<Response> {
    const key = `${method.toUpperCase()}:${path}`;
    const handler = this.routes.get(key);
    if (!handler) return new Response("not found", { status: 404 });
    try {
      return await handler(new Request(`http://localhost${path}`, { method }));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return new Response(msg, { status: 500 });
    }
  }
}

export function createRouter(auth: AuthService): Router {
  return new Router(auth);
}
