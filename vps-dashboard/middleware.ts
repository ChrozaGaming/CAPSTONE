/**
 * Next.js Middleware — protect authenticated routes + role-based.
 *
 * - /dashboard, /admin, /operator → require login
 * - /admin                        → require role=manager
 * - /operator                     → require role=operator
 *
 * NextAuth v5 menyediakan auth() yang dapat di-export sebagai middleware.
 * Logic detail (redirect by role) dilakukan di sini.
 */
import { auth } from '@/lib/auth';
import { NextResponse } from 'next/server';

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const session = req.auth;

  // Protected paths
  const isProtected =
    pathname.startsWith('/dashboard') ||
    pathname.startsWith('/admin') ||
    pathname.startsWith('/operator');

  if (!isProtected) return NextResponse.next();

  if (!session?.user) {
    const loginUrl = new URL('/login', req.nextUrl.origin);
    return NextResponse.redirect(loginUrl);
  }

  const role = (session.user as any).role;

  if (pathname.startsWith('/admin') && role !== 'manager') {
    return NextResponse.redirect(new URL('/dashboard', req.nextUrl.origin));
  }
  if (pathname.startsWith('/operator') && role !== 'operator') {
    return NextResponse.redirect(new URL('/dashboard', req.nextUrl.origin));
  }

  return NextResponse.next();
});

export const config = {
  // Hindari middleware run di static files & api/auth (auth handler-nya sendiri).
  matcher: [
    '/((?!api/auth|api/users|api/_next|_next/static|_next/image|favicon|.*\\..*).*)',
  ],
};
