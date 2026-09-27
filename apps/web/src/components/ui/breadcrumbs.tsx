import Link from 'next/link';
import { type JSX } from 'react';

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

/** The current page is always the last, unlinked item (`aria-current="page"`)
 * - every earlier item is a link back up the training hierarchy. */
export function Breadcrumbs({
  items,
  className,
}: {
  items: BreadcrumbItem[];
  className?: string;
}): JSX.Element {
  return (
    <nav aria-label="Breadcrumb" className={className}>
      <ol className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          return (
            <li key={`${item.label}-${index}`} className="flex items-center gap-1.5">
              {index > 0 && <span aria-hidden="true">/</span>}
              {isLast || !item.href ? (
                <span aria-current={isLast ? 'page' : undefined} className="text-foreground">
                  {item.label}
                </span>
              ) : (
                <Link href={item.href} className="underline hover:text-foreground">
                  {item.label}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
