'use client';

import type {ReactElement, ReactNode} from 'react';

export function AppProviders({children}: {children: ReactNode}): ReactElement {
  return <>{children}</>;
}
