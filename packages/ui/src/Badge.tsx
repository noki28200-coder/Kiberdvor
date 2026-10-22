import type { ReactNode } from 'react';

interface BadgeProps {
  tone?: 'neutral' | 'success' | 'warning' | 'danger';
  children: ReactNode;
}

export function Badge({ tone = 'neutral', children }: BadgeProps) {
  return <span className={`kd-badge kd-badge--${tone}`}>{children}</span>;
}
