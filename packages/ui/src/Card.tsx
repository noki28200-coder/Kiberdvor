import type { ReactNode } from 'react';

interface CardProps {
  title?: ReactNode;
  children: ReactNode;
}

export function Card({ title, children }: CardProps) {
  return (
    <section className="kd-card">
      {title && <h2 className="kd-card__title">{title}</h2>}
      {children}
    </section>
  );
}
