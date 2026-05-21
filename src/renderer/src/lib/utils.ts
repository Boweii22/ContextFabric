import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDate(timestamp: number): string {
  const date = new Date(timestamp)
  const now = new Date()
  const diff = now.getTime() - date.getTime()

  if (diff < 60000) return 'just now'
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`

  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined })
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`
}

export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str
  return str.substring(0, maxLength - 3) + '...'
}

export function getTypeColor(type: string): string {
  const colors: Record<string, string> = {
    conversation: '#6366F1',
    document: '#8B5CF6',
    code: '#06B6D4',
    note: '#10B981',
    decision: '#F59E0B',
    entity: '#EF4444',
    project: '#EC4899',
    style: '#14B8A6',
    preference: '#84CC16',
    person: '#F97316',
  }
  return colors[type] || '#6366F1'
}

export function getTypeIcon(type: string): string {
  const icons: Record<string, string> = {
    conversation: '💬',
    document: '📄',
    code: '⌨️',
    note: '📝',
    decision: '⚡',
    entity: '🔷',
    project: '🗂️',
  }
  return icons[type] || '🔷'
}

export function debounce<T extends (...args: unknown[]) => unknown>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout>
  return (...args: Parameters<T>) => {
    clearTimeout(timer)
    timer = setTimeout(() => fn(...args), delay)
  }
}

export function randomBetween(min: number, max: number): number {
  return Math.random() * (max - min) + min
}
