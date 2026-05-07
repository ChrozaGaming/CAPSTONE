/**
 * Prisma seed — 3 demo users untuk capstone (operator, supervisor, manager).
 *
 * Run:   npm run prisma:seed
 *        atau   npx tsx prisma/seed.ts
 *
 * Idempotent: pakai upsert berdasar email, jadi aman re-run berkali-kali.
 */
import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const DEMO_USERS = [
  {
    email: 'operator@capstone.dev',
    name:  'Hilmy (Operator)',
    plain: 'operator123',
    role:  Role.operator,
    edge_url: 'http://localhost:3000',
  },
  {
    email: 'supervisor@capstone.dev',
    name:  'Pak Andi (Supervisor)',
    plain: 'supervisor123',
    role:  Role.supervisor,
    edge_url: null,
  },
  {
    email: 'manager@capstone.dev',
    name:  'Pak Budi (Manager)',
    plain: 'manager123',
    role:  Role.manager,
    edge_url: null,
  },
];

async function main() {
  console.log('🌱 Seeding 3 demo users…');

  for (const u of DEMO_USERS) {
    const hash = await bcrypt.hash(u.plain, 10);
    const user = await prisma.user.upsert({
      where: { email: u.email },
      update: {
        name:     u.name,
        password: hash,
        role:     u.role,
        edge_url: u.edge_url,
      },
      create: {
        email:    u.email,
        name:     u.name,
        password: hash,
        role:     u.role,
        edge_url: u.edge_url,
      },
    });
    console.log(`  ✓ ${user.role.padEnd(11)} → ${user.email}  (password: ${u.plain})`);
  }

  console.log('\n✅ Seed selesai. Login credentials:\n');
  for (const u of DEMO_USERS) {
    console.log(`   [${u.role.padEnd(11)}]  ${u.email}  /  ${u.plain}`);
  }
  console.log('\n   ⚠ JANGAN dipakai di production — ganti password setelah deploy!');
}

main()
  .then(async () => { await prisma.$disconnect(); })
  .catch(async (e) => {
    console.error('❌ Seed gagal:', e);
    await prisma.$disconnect();
    process.exit(1);
  });
