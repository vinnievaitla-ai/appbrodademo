import type { Folder } from './types'

const FOLDERS_KEY = 'appbroda-folders'
const variantFolderKey = (id: string) => `appbroda-vf-${id}`

function isBrowser() {
  return typeof window !== 'undefined'
}

export function getFolders(): Folder[] {
  if (!isBrowser()) return []
  try {
    const raw = localStorage.getItem(FOLDERS_KEY)
    return raw ? (JSON.parse(raw) as Folder[]) : []
  } catch {
    return []
  }
}

function saveFolders(folders: Folder[]) {
  if (!isBrowser()) return
  localStorage.setItem(FOLDERS_KEY, JSON.stringify(folders))
}

export function createFolder(name: string): Folder {
  const folder: Folder = {
    id: `folder-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: name.trim(),
    createdAt: new Date().toISOString(),
  }
  saveFolders([...getFolders(), folder])
  return folder
}

export function renameFolder(id: string, name: string): void {
  saveFolders(getFolders().map(f => f.id === id ? { ...f, name: name.trim() } : f))
}

export function deleteFolder(id: string): void {
  saveFolders(getFolders().filter(f => f.id !== id))
}

export function getVariantFolder(variantId: string): string | null {
  if (!isBrowser()) return null
  return localStorage.getItem(variantFolderKey(variantId))
}

export function setVariantFolder(variantId: string, folderId: string | null): void {
  if (!isBrowser()) return
  if (folderId) {
    localStorage.setItem(variantFolderKey(variantId), folderId)
  } else {
    localStorage.removeItem(variantFolderKey(variantId))
  }
}

export function assignVariantsToFolder(variantIds: string[], folderId: string | null): void {
  variantIds.forEach(id => setVariantFolder(id, folderId))
}
