const REPLIT_API = "https://0c4449ed-d5b0-42f2-9674-dca9c719e186-00-39bfl9q91p2em.sisko.replit.dev";

export async function onRequest(context) {
  const url = new URL(context.request.url);
  // Normalize double slashes (Android BACKEND_ROOT trailing slash + "/api/..." prefix)
  const normalizedPath = url.pathname.replace(/\/\/+/g, "/");
  const targetUrl = REPLIT_API + normalizedPath + url.search;

  const headers = new Headers();
  for (const [key, value] of context.request.headers.entries()) {
    if (!["host", "cf-connecting-ip", "cf-ray", "cf-visitor"].includes(key.toLowerCase())) {
      headers.set(key, value);
    }
  }

  const isBodyless = ["GET", "HEAD"].includes(context.request.method.toUpperCase());

  const response = await fetch(targetUrl, {
    method: context.request.method,
    headers,
    body: isBodyless ? undefined : context.request.body,
    redirect: "follow",
  });

  const respHeaders = new Headers(response.headers);
  respHeaders.set("Access-Control-Allow-Origin", context.request.headers.get("origin") || "*");
  respHeaders.set("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  respHeaders.set("Access-Control-Allow-Headers", "Content-Type,Authorization,x-admin-token");
  respHeaders.set("Access-Control-Allow-Credentials", "true");

  if (context.request.method.toUpperCase() === "OPTIONS") {
    return new Response(null, { status: 204, headers: respHeaders });
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: respHeaders,
  });
}
