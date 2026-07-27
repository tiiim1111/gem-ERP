import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE_NAME } from '@gemerp/shared';

/**
 * Cheap first-pass auth gate: redirect to /login when the session cookie is
 * absent. The API remains the real authority — a present-but-expired cookie
 * passes here and is caught by the client session provider on /auth/me (401).
 *
 * Deliberately no cookie-present redirect away from /login: a stale cookie
 * that the API rejects would otherwise bounce the browser in a loop between
 * /login and the dashboard.
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname === '/login') {
    return NextResponse.next();
  }

  if (!request.cookies.has(SESSION_COOKIE_NAME)) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = '/login';
    loginUrl.search = '';
    if (pathname !== '/') {
      loginUrl.searchParams.set('next', pathname + request.nextUrl.search);
    }
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  // Everything except Next internals and static files with an extension.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)'],
};
