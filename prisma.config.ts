import { defineConfig } from 'prisma/config';

/**
 * Prisma CLI configuration.
 *
 * Prisma 7 no longer accepts a connection URL inside `schema.prisma`, which is an improvement: the
 * schema is now purely structural and the credential lives in one place, read from the environment
 * and never committed.
 *
 * The URL is resolved lazily to an empty string when unset so that `prisma generate` and
 * `prisma migrate diff` — neither of which touches a database — work in a fresh clone with no
 * PostgreSQL configured. Commands that do need a database (`migrate dev`, `migrate deploy`) fail
 * with Prisma's own connection error, which names the problem clearly.
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    // The seed builds its demo quotes by running the real routing engine over the sandbox adapters,
    // so it imports the compiled workspace packages and needs a TypeScript runner. Prisma does not
    // pass this through a shell, so the build cannot be chained here — `npm run db:seed` and
    // `npm run db:reset` compile first, and invoking `prisma db seed` directly on an unbuilt clone
    // fails with the guidance in prisma/seed.ts.
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: process.env['DATABASE_URL'] ?? '',
  },
});
