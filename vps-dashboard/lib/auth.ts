/**
 * NextAuth.js v5 config — Credentials provider (email + password).
 *
 * Strategy: JWT-based session (bukan database-backed Session model)
 * supaya:
 *   1. Token bisa di-share ke local server.js untuk verify
 *   2. Stateless — tidak butuh DB roundtrip per request
 *
 * Adapter Prisma TETAP dipakai untuk:
 *   - Lookup user di User table (Credentials authorize)
 *   - Future: link OAuth accounts (Account table)
 */
import NextAuth, { type NextAuthConfig } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { PrismaAdapter } from '@auth/prisma-adapter';
import { z } from 'zod';
import * as bcrypt from 'bcryptjs';
import { prisma } from '@/lib/db';
import { logAudit } from '@/lib/audit-log';
import type { Role } from '@/lib/jwt';

// Validation schema untuk credentials input
const CredentialsSchema = z.object({
  email:    z.string().email(),
  password: z.string().min(6),
});

export const authConfig = {
  adapter: PrismaAdapter(prisma) as any,
  // Pakai JWT strategy supaya cookie token bisa di-share dengan local server.js.
  // Database session strategy tidak compatible dengan use case kita.
  session: { strategy: 'jwt' },
  secret:  process.env.NEXTAUTH_SECRET,
  pages: {
    signIn: '/login',
  },
  providers: [
    Credentials({
      name: 'credentials',
      credentials: {
        email:    { label: 'Email',    type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(raw) {
        const parsed = CredentialsSchema.safeParse(raw);
        if (!parsed.success) {
          await logAudit({
            action:     'user_login_failed',
            actorEmail: typeof (raw as any)?.email === 'string' ? (raw as any).email : null,
            metadata:   { reason: 'invalid input format' },
          });
          return null;
        }

        const { email, password } = parsed.data;
        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) {
          await logAudit({
            action:     'user_login_failed',
            actorEmail: email,
            metadata:   { reason: 'user not found' },
          });
          return null;
        }

        const ok = await bcrypt.compare(password, user.password);
        if (!ok) {
          await logAudit({
            action:     'user_login_failed',
            actorEmail: email,
            actorRole:  user.role,
            metadata:   { reason: 'wrong password' },
          });
          return null;
        }

        // Sukses
        await logAudit({
          action:     'user_login',
          actorId:    user.id,
          actorEmail: user.email,
          actorRole:  user.role,
        });

        return {
          id:    user.id,
          email: user.email,
          name:  user.name ?? user.email,
          role:  user.role as Role,
        };
      },
    }),
  ],
  callbacks: {
    /**
     * Pass `role` ke JWT supaya tersedia di client session.
     * Token JWT otomatis include sub/email/name dari NextAuth core.
     */
    async jwt({ token, user }) {
      if (user) {
        token.role = (user as any).role;
        token.id   = (user as any).id;
      }
      return token;
    },
    /**
     * Expose role + id ke session.user untuk consumption di client.
     */
    async session({ session, token }) {
      if (session.user && token) {
        (session.user as any).id   = token.id;
        (session.user as any).role = token.role;
      }
      return session;
    },
    /**
     * Authorize callback (middleware) — gating per-path berdasar role.
     * Dipakai oleh middleware.ts (Phase 4).
     */
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      const isOnLogin  = nextUrl.pathname.startsWith('/login');

      if (isOnLogin) {
        // Sudah login & buka /login → redirect ke /dashboard
        if (isLoggedIn) return Response.redirect(new URL('/dashboard', nextUrl));
        return true;
      }
      // Halaman lain butuh login
      return isLoggedIn;
    },
  },
  events: {
    async signOut(message: any) {
      // Log logout event. NextAuth v5 events.signOut bisa dapat token atau session.
      try {
        const token = message?.token;
        if (token) {
          await logAudit({
            action:     'user_logout',
            actorId:    token.id ?? token.sub ?? null,
            actorEmail: token.email ?? null,
            actorRole:  token.role ?? null,
          });
        }
      } catch { /* best-effort */ }
    },
  },
} satisfies NextAuthConfig;

export const { handlers, signIn, signOut, auth } = NextAuth(authConfig);
