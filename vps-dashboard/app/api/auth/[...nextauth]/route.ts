/**
 * NextAuth.js v5 catch-all API route.
 * Handler ditarik dari config di lib/auth.ts.
 */
import { handlers } from '@/lib/auth';

export const { GET, POST } = handlers;
