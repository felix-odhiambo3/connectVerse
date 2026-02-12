import { NextResponse, type NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  // --- Rate Limiting (Placeholder) ---
  // For production, you should implement a real rate-limiting solution
  // here to prevent brute-force attacks on login or meeting creation.
  // Example using a library like @upstash/ratelimit:
  //
  // import { Ratelimit } from "@upstash/ratelimit";
  // import { kv } from "@vercel/kv";
  // const ratelimit = new Ratelimit({
  //   redis: kv,
  //   limiter: Ratelimit.slidingWindow(5, "10 s"), // 5 requests per 10 seconds
  // });
  // const ip = request.ip ?? "127.0.0.1";
  // const { success } = await ratelimit.limit(ip);
  // if (!success) {
  //   return new NextResponse("Rate limit exceeded", { status: 429 });
  // }


  // --- CORS Configuration ---
  // The below is a basic CORS setup. If you have custom API routes,
  // you can configure which origins are allowed to access them.
  // Note: Client-side Firebase requests are not affected by this middleware.
  const response = NextResponse.next();

  // In production, you should restrict this to your app's domain.
  response.headers.set('Access-Control-Allow-Origin', '*'); 
  response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  return response;
}

// See "Matching Paths" below to learn more
export const config = {
  matcher: [
    // This middleware will apply to all routes except for static assets.
    '/((?!api|_next/static|_next/image|favicon.ico).*)',
  ],
};
