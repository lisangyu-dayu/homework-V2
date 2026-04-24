'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { findByParentToken } from '@/db/dao/children';
import { removeMistake, setResolvedForChild } from '@/db/dao/mistakes';
import { getParentCookieName } from '@/lib/config';

async function requireActionChild() {
  const cookieStore = await cookies();
  const token = cookieStore.get(getParentCookieName())?.value;
  const child = token ? findByParentToken(token) : null;
  if (!child) throw new Error('authentication required');
  return child;
}

function readRequiredField(formData: FormData, key: string): string {
  const value = formData.get(key);
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`missing field: ${key}`);
  }
  return value.trim();
}

function revalidateReturnPath(returnTo: string) {
  if (returnTo.startsWith('/mistakes')) {
    revalidatePath(returnTo);
  }
  revalidatePath('/mistakes');
}

export async function setMistakeResolvedAction(formData: FormData) {
  const child = await requireActionChild();
  const mistakeId = readRequiredField(formData, 'mistakeId');
  const resolved = readRequiredField(formData, 'resolved') === '1';
  const returnTo = readRequiredField(formData, 'returnTo');

  const updated = setResolvedForChild(mistakeId, child.id, resolved);
  if (!updated) throw new Error('mistake not found');

  revalidateReturnPath(returnTo);
}

export async function deleteMistakeAction(formData: FormData) {
  const child = await requireActionChild();
  const mistakeId = readRequiredField(formData, 'mistakeId');
  const returnTo = readRequiredField(formData, 'returnTo');

  const removed = await removeMistake(mistakeId, child.id);
  if (!removed) throw new Error('mistake not found');

  revalidateReturnPath(returnTo);
}
