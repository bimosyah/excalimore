import { LoginRequestSchema } from '@excalimore/types'
import { zodResolver } from '@hookform/resolvers/zod'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import type * as React from 'react'
import { useForm } from 'react-hook-form'
import type { z } from 'zod'
import { useLogin } from '../api/auth'

export const Route = createFileRoute('/login')({
  component: LoginPage,
})

type LoginInput = z.infer<typeof LoginRequestSchema>

function LoginPage() {
  const navigate = useNavigate()
  const login = useLogin()
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginInput>({ resolver: zodResolver(LoginRequestSchema) })

  return (
    <main style={pageStyle}>
      <div style={cardStyle}>
        <h1 style={{ margin: 0 }}>Sign in to Excalimore</h1>
        <form
          onSubmit={handleSubmit(async (values) => {
            await login.mutateAsync(values)
            navigate({ to: '/' })
          })}
          style={formStyle}
        >
          <label style={labelStyle}>
            Email
            <input type="email" autoComplete="email" {...register('email')} style={inputStyle} />
            {errors.email && <span style={errorStyle}>{errors.email.message}</span>}
          </label>
          <label style={labelStyle}>
            Password
            <input
              type="password"
              autoComplete="current-password"
              {...register('password')}
              style={inputStyle}
            />
            {errors.password && <span style={errorStyle}>{errors.password.message}</span>}
          </label>
          {login.error && (
            <div style={errorBannerStyle}>
              {login.error instanceof Error ? login.error.message : 'login failed'}
            </div>
          )}
          <button type="submit" disabled={login.isPending} style={buttonStyle}>
            {login.isPending ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        <p style={{ fontSize: '0.85em', color: '#666', marginTop: '1rem' }}>
          Have an invite? <Link to="/signup">Sign up here</Link>.
        </p>
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
