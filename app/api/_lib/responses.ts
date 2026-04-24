import { NextResponse } from 'next/server';
import { AuthError } from '@/lib/errors';

export function errorResponse(status: number, code: string, message: string) {
  return NextResponse.json({ ok: false, error: { code, message } }, { status });
}

export function authErrorResponse(error: AuthError) {
  return errorResponse(401, error.code, error.message);
}
