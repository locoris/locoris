const ALLOWED_METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);
const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function errorResponse(status, code, message) {
  return Response.json(
    { error: code, code, message },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff"
      }
    }
  );
}

function readUpstreamOrigin(value) {
  let url;

  try {
    url = new URL(String(value ?? ""));
  } catch {
    throw new Error("APP_API_BASE_URL must be a valid URL.");
  }

  if (url.protocol !== "https:" || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("APP_API_BASE_URL must be an HTTPS origin.");
  }

  return url.origin;
}

function isSameOriginBrowserRequest(request, requestUrl) {
  const origin = request.headers.get("Origin");
  if (origin && origin !== requestUrl.origin) return false;

  const fetchSite = request.headers.get("Sec-Fetch-Site");
  return !fetchSite || fetchSite === "same-origin" || fetchSite === "none";
}

export async function onRequest({ request, env }) {
  if (!ALLOWED_METHODS.has(request.method)) {
    return errorResponse(405, "METHOD_NOT_ALLOWED", "Method not allowed.");
  }

  const requestUrl = new URL(request.url);
  const upstreamPath = requestUrl.pathname.replace(/^\/api(?=\/|$)/, "") || "/";

  if (
    !upstreamPath.startsWith("/v1/auth/") &&
    !upstreamPath.startsWith("/v1/account/") &&
    upstreamPath !== "/v1/capabilities" &&
    upstreamPath !== "/v1/plans"
  ) {
    return errorResponse(404, "NOT_FOUND", "Cloud API route not found.");
  }

  if (STATE_CHANGING_METHODS.has(request.method) && !isSameOriginBrowserRequest(request, requestUrl)) {
    return errorResponse(403, "CROSS_SITE_REQUEST_BLOCKED", "Cross-site application request blocked.");
  }

  let upstreamOrigin;

  try {
    upstreamOrigin = readUpstreamOrigin(env.APP_API_BASE_URL);
  } catch (error) {
    console.error(error);
    return errorResponse(503, "APP_API_NOT_CONFIGURED", "Cloud service is not configured.");
  }

  const upstreamUrl = new URL(`${upstreamPath}${requestUrl.search}`, upstreamOrigin);
  const headers = new Headers(request.headers);

  for (const name of ["Host", "Origin", "Referer", "CF-Connecting-IP", "CF-Ray", "CF-Visitor"]) {
    headers.delete(name);
  }

  headers.set("X-Locoris-Web-App", "1");
  headers.set("X-Locoris-Client-Origin", requestUrl.origin);
  const clientIp = request.headers.get("CF-Connecting-IP");
  if (clientIp) headers.set("X-Forwarded-For", clientIp);

  try {
    const upstreamResponse = await fetch(upstreamUrl, {
      method: request.method,
      headers,
      body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
      redirect: "manual"
    });
    const responseHeaders = new Headers(upstreamResponse.headers);

    for (const name of [
      "Access-Control-Allow-Credentials",
      "Access-Control-Allow-Headers",
      "Access-Control-Allow-Methods",
      "Access-Control-Allow-Origin"
    ]) {
      responseHeaders.delete(name);
    }

    responseHeaders.set("Cache-Control", "no-store");
    responseHeaders.set("X-Content-Type-Options", "nosniff");

    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers: responseHeaders
    });
  } catch (error) {
    console.error("Locoris Web upstream request failed", error);
    return errorResponse(502, "APP_API_UNAVAILABLE", "Cloud service is temporarily unavailable.");
  }
}
