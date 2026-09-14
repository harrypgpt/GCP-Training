import { type HTMLAttributes, type JSX } from 'react';

import { cn } from '@/lib/cn';

export function Container({ className, ...props }: HTMLAttributes<HTMLDivElement>): JSX.Element {
  return <div className={cn('mx-auto w-full max-w-6xl px-6 md:px-8', className)} {...props} />;
}
