import { AuthService } from "./auth.js";
import { createRouter } from "./router.js";

const auth = new AuthService();
const router = createRouter(auth);

router.get("/health", () => new Response("ok"));
router.post("/login", async (req) => {
  const body = await req.json();
  const result = auth.login(body.email);
  return new Response(JSON.stringify(result), {
    status: result.ok ? 200 : 401,
    headers: { "content-type": "application/json" },
  });
});

export { router, auth };
