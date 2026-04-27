import { SignupRequestSchema } from '@excalimore/types'
import { zodResolver } from '@hookform/resolvers/zod'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import type * as React from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { useSignup } from '../api/auth'

const SearchSchema = z.object({
  token: z.string().optional(),
  bootstrap: z.string().optional(),
})

export const Route = createFileRoute('/signup')({
  validateSearch: SearchSchema.parse,
  component: SignupPage,
})

const FormSchema = SignupRequestSchema.omit({ token: true })
type FormInput = z.infer<typeof FormSchema>

function SignupPage() {
  const navigate = useNavigate()
  const search = Route.useSearch()
  const signup = useSignup()
  const token = search.token ?? search.bootstrap ?? ''
  const isBootstrap = Boolean(search.bootstrap)
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormInput>({ resolver: zodResolver(FormSchema) })

  if (!token) {
    return (
      <main style={pageStyle}>
        <div style={cardStyle}>
          <h1>Invite required</h1>
          <p>This Excalimore instance is invite-only. Open your invite link to sign up.</p>
        </div>
      </main>
    )
  }

  return (
    <main style={pageStyle}>
      <div style={cardStyle}>
        <h1 style={{ margin: 0 }}>
          {isBootstrap ? 'Bootstrap admin account' : 'Create your account'}
        </h1>
        {isBootstrap && (
          <p style={{ fontSize: '0.85em', color: '#666' }}>
            This is a first-run setup link. The user you create will be the admin.
          </p>
        )}
        <form
          onSubmit={handleSubmit(async (values) => {
            const res = await signup.mutateAsync({ ...values, token })
            // Navigate to the redirectTo path; '/' is always safe, others go through router parsing.
            if (res.redirectTo === '/' || !res.redirectTo) {
              navigate({ to: '/' })
            } else {
              navigate({ to: res.redirectTo as never })
            }
          })}
          style={formStyle}
        >
          <label style={labelStyle}>
            Name
            <input {...register('name')} style={inputStyle} />
            {errors.name && <span style={errorStyle}>{errors.name.message}</span>}
          </label>
          <label style={labelStyle}>
            Email
            <input type="email" autoComplete="email" {...register('email')} style={inputStyle} />
            {errors.email && <span style={errorStyle}>{errors.email.message}</span>}
          </label>
          <label style={labelStyle}>
            Password (min 8 chars)
            <input
              type="password"
              autoComplete="new-password"
              {...register('password')}
              style={inputStyle}
            />
            {errors.password && <span style={errorStyle}>{errors.password.message}</span>}
          </label>
          {signup.error && (
            <div style={errorBannerStyle}>
              {signup.error instanceof Error ? signup.error.message : 'signup failed'}
            </div>
          )}
          <button type="submit" disabled={signup.isPending} style={buttonStyle}>
            {signup.isPending ? 'Creating…' : 'Create account'}
          </button>
        </form>
      </div>
    </main>
  )
}

const pageStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: '100vh',
  padding: '2rem',
}
const cardStyle: React.CSSProperties = {
  width: '100%',
  maxWidth: 360,
  background: 'white',
  border: '1px solid #e5e5e5',
  borderRadius: 12,
  padding: '2rem',
  boxShadow: '0 4px 12px rgba(0,0,0,0.04)',
}
const formStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.75rem',
  marginTop: '1rem',
}
const labelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.25rem',
  fontSize: '0.9em',
}
const inputStyle: React.CSSProperties = {
  padding: '0.5rem 0.75rem',
  borderRadius: 6,
  border: '1px solid #ddd',
  fontSize: '1em',
}
const buttonStyle: React.CSSProperties = {
  padding: '0.6rem 1rem',
  background: '#1971c2',
  color: 'white',
  border: 'none',
  borderRadius: 6,
  fontSize: '1em',
  cursor: 'pointer',
  marginTop: '0.5rem',
}
const errorStyle: React.CSSProperties = { color: '#c92a2a', fontSize: '0.85em' }
const errorBannerStyle: React.CSSProperties = {
  ...errorStyle,
  padding: '0.5rem',
  background: '#fff5f5',
  borderRadius: 6,
}
