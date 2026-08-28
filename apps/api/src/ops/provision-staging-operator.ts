/**
 * Provisions one labelled synthetic staging operator.
 *
 * This is not the demo tenant and is forbidden unless DEPLOY_ENV=staging. Demo emails and
 * documented demo passwords are rejected. The organization metadata marks the row as synthetic.
 *
 * Run from the migrate image (`--profile synthetic`) or:
 *   DEPLOY_ENV=staging DATABASE_URL=... STAGING_OPERATOR_EMAIL=... STAGING_OPERATOR_PASSWORD=... \
 *     npx tsx apps/api/src/ops/provision-staging-operator.ts
 */
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  ConfigurationError,
  DEMO_USER_EMAIL,
  hashPassword,
  isForbiddenProductionSecret,
  OTHER_USER_EMAIL,
} from '@meridian/core';

const STAGING_ORG_ID = 'org_staging_synthetic';
const STAGING_ORG_SLUG = 'staging-synthetic';
const STAGING_ORG_NAME = '[SYNTHETIC] Staging operator — not production customer data';
const STAGING_USER_ID = 'usr_staging_synthetic';
const STAGING_MEMBER_ID = 'mem_staging_synthetic';

export async function provisionStagingOperator(env: NodeJS.ProcessEnv = process.env): Promise<{
  readonly organizationId: string;
  readonly email: string;
}> {
  if (env['DEPLOY_ENV'] !== 'staging') {
    throw new ConfigurationError(
      'Staging operator provisioning requires DEPLOY_ENV=staging. It is not a production customer onboarding path.',
      { deployEnv: env['DEPLOY_ENV'] ?? null },
    );
  }

  const databaseUrl = env['DATABASE_URL'];
  const email = env['STAGING_OPERATOR_EMAIL']?.trim().toLowerCase();
  const password = env['STAGING_OPERATOR_PASSWORD'];

  if (databaseUrl === undefined || databaseUrl.trim() === '') {
    throw new ConfigurationError('DATABASE_URL is required to provision a staging operator.');
  }
  if (email === undefined || email === '') {
    throw new ConfigurationError('STAGING_OPERATOR_EMAIL is required.');
  }
  if (password === undefined || password.length < 12) {
    throw new ConfigurationError('STAGING_OPERATOR_PASSWORD must be at least 12 characters.');
  }
  if (email === DEMO_USER_EMAIL || email === OTHER_USER_EMAIL || email.includes('demo-trading')) {
    throw new ConfigurationError(
      'Staging operator email must not be a documented demo tenant address.',
      { email },
    );
  }
  if (isForbiddenProductionSecret(password)) {
    throw new ConfigurationError(
      'STAGING_OPERATOR_PASSWORD must not be a documented demo password or default secret.',
    );
  }

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  try {
    const passwordHash = await hashPassword(password);
    await prisma.organization.upsert({
      where: { id: STAGING_ORG_ID },
      create: {
        id: STAGING_ORG_ID,
        name: STAGING_ORG_NAME,
        slug: STAGING_ORG_SLUG,
        countryCode: 'SG',
        metadata: { synthetic: true, notProductionCustomerData: true },
      },
      update: {
        name: STAGING_ORG_NAME,
        metadata: { synthetic: true, notProductionCustomerData: true },
      },
    });
    await prisma.user.upsert({
      where: { id: STAGING_USER_ID },
      create: {
        id: STAGING_USER_ID,
        email,
        displayName: 'Staging operator (synthetic)',
        passwordHash,
        passwordSetAt: new Date(),
      },
      update: {
        email,
        passwordHash,
        passwordSetAt: new Date(),
        status: 'active',
      },
    });
    await prisma.organizationMember.upsert({
      where: { id: STAGING_MEMBER_ID },
      create: {
        id: STAGING_MEMBER_ID,
        organizationId: STAGING_ORG_ID,
        userId: STAGING_USER_ID,
        role: 'owner',
        status: 'active',
        joinedAt: new Date(),
      },
      update: {
        role: 'owner',
        status: 'active',
      },
    });
    return { organizationId: STAGING_ORG_ID, email };
  } finally {
    await prisma.$disconnect();
  }
}

async function main(): Promise<void> {
  const result = await provisionStagingOperator();
  process.stderr.write(
    `Provisioned synthetic staging operator ${result.email} in ${result.organizationId}.\n`,
  );
}

const invokedDirectly = process.argv[1]?.includes('provision-staging-operator') === true;
if (invokedDirectly) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
