export async function onRequest(context) {
  const { request, next, env } = context;
  const url = new URL(request.url);

  // 1. Identify "Private" paths
  const isAppPath = url.pathname.startsWith('/apps/');

  if (isAppPath) {
    // 2. Check for Auth (Cookie-based for simplicity)
    const cookie = request.headers.get('Cookie') || '';
    const hasAuth = cookie.includes('adam_tool_session=true');

    if (!hasAuth) {
        // Redirect to login if not authenticated
        // For now, let's just log and allow, OR we can show a brief "Unauthorized" message.
        // Uncomment the next 3 lines to lock it down now:
        // return new Response('🌿 Solarpunk Shield: Please login to access this tool.', {
        //   status: 401
        // });
        console.log(`[Gatekeeper] Unauthorized access attempt to ${url.pathname}`);
    }

    // 3. Simple Tracking Ping (Server-side)
    // In a real app, we'd write to Cloudflare KV or D1 here.
    console.log(`[Usage Log] App: ${url.pathname} | User: ${hasAuth ? 'Auth' : 'Guest'} | Time: ${new Date().toISOString()}`);
  }

  // Allow the request to proceed to the static file
  return next();
}
