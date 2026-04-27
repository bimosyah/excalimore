import { z } from 'zod'

const EnvSchema = z.object({
  DATABASE_URL: z.string().url(),
  SESSION_SECRET: z.string().min(16),
  PUBLIC_URL: z.string().url(),
  PORT: z.coerce.number().int().positive().default(3000),
  RATE_LIMIT_LOGIN: z.coerce.number().int().positive().default(5),
  SESSION_MAX_AGE: z.coerce.number().int().positive().default(60 * 60 * 24 * 30),
  BOOTSTRAP_TOKEN_TTL: z.coerce.number().int().positive().default(60 * 60),
})

export type Env = z.infer<typeof EnvSchema>

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source)
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n')
    throw new Error(`Invalid environment configuration:\n${issues}`)
  }
  return parsed.data
}
