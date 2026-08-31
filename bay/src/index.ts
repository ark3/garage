interface Env {
  GARAGE: DurableObjectNamespace;
}

export class Garage {
  ctx: DurableObjectState;

  constructor(ctx: DurableObjectState, _env: Env) {
    this.ctx = ctx;
  }

  async fetch(_request: Request): Promise<Response> {
    // Touch SQL storage so the SQLite backend materializes on first use.
    this.ctx.storage.sql.exec("SELECT 1");
    return new Response("ok\n");
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      const stub = env.GARAGE.get(env.GARAGE.idFromName("garage"));
      return stub.fetch(request);
    }
    return new Response("not found\n", { status: 404 });
  },
};
