import { z } from 'zod';

/**
 * Client/runtime environment for the web app. Only `NEXT_PUBLIC_*` values are
 * available in the browser, so they must be referenced statically (not via a
 * computed key) for Next.js to inline them.
 */
const clientEnvSchema = z.object({
  NEXT_PUBLIC_API_BASE_URL: z.string().url().default('http://localhost:3001'),
});

const parsed = clientEnvSchema.safeParse({
  NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL,
});

if (!parsed.success) {
  throw new Error(
    `Invalid web environment configuration:\n${parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n')}`,
  );
}

export const env = parsed.data;
