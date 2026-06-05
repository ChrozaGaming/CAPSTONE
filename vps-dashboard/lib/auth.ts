/**
 * NextAuth.js v5 config — Credentials provider (email + password).
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
  session: { strategy: 'jwt' },
  secret:  process.env.NEXTAUTH_SECRET,
  pages: {
    signIn: '/login',
    error:  '/login', // Mencegah NextAuth melempar ke halaman error default HTML jika DB crash
  },
  providers: [
    Credentials({
      name: 'credentials',
      credentials: {
        email:    { label: 'Email',    type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(raw) {
        try {
          const parsed = CredentialsSchema.safeParse(raw);
          if (!parsed.success) {
            // Disesuaikan ke ENUM 'DELETE' atau sejenisnya, atau bungkus aman agar tidak mematikan auth jika gagal log
            await logAudit({
              action:     'LOGIN',
              actorEmail: typeof (raw as any)?.email === 'string' ? (raw as any).email : null,
              metadata:   { reason: 'invalid input format', success: false },
            }).catch(() => null);
            return null;
          }

          const { email, password } = parsed.data;
          const user = await prisma.user.findUnique({ where: { email } });

          if (!user) {
            await logAudit({
              action:     'LOGIN',
              actorEmail: email,
              metadata:   { reason: 'user not found', success: false },
            }).catch(() => null);
            return null;
          }

          const ok = await bcrypt.compare(password, user.password);
          if (!ok) {
            await logAudit({
              action:     'LOGIN',
              actorEmail: email,
              actorRole:  user.role,
              metadata:   { reason: 'wrong password', success: false },
            }).catch(() => null);
            return null;
          }

          // Sukses Login
          await logAudit({
            action:     'LOGIN',
            actorId:    user.id,
            actorEmail: user.email,
            actorRole:  user.role,
            metadata:   { success: true }
          }).catch(() => null);

          return {
            id:    user.id,
            email: user.email,
            name:  user.name ?? user.email,
            role:  user.role as Role,
          };
        } catch (error) {
          // KUNCI UTAMA: Jika kredensial DB Vercel bermasalah, tangkap di sini agar tidak memicu loop crash
          console.error("CRITICAL AUTH ERROR (SUPABASE/PRISMA):", error);
          return null;
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.role = (user as any).role;
        token.id   = (user as any).id;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && token) {
        (session.user as any).id   = token.id;
        (session.user as any).role = token.role;
      }
      return session;
    },
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      const isOnLogin  = nextUrl.pathname.startsWith('/login');

      if (isOnLogin) {
        if (isLoggedIn) {
          // Pakai konstruktor URL murni agar redirect di App Router Vercel stabil
          return Response.redirect(new URL('/dashboard', nextUrl.origin));
        }
        return true;
      }
      return isLoggedIn;
    },
  },
  events: {
    async signOut(message: any) {
      try {
        const token = message?.token;
        if (token) {
          await logAudit({
            action:     'LOGOUT',
            actorId:    token.id ?? token.sub ?? null,
            actorEmail: token.email ?? null,
            actorRole:  token.role ?? null,
          }).catch(() => null);
        }
      } catch { /* best-effort */ }
    },
  },
} satisfies NextAuthConfig;

export const { handlers, signIn, signOut, auth } = NextAuth(authConfig);
