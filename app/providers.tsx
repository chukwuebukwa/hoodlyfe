'use client';

import {PrivyProvider} from '@privy-io/react-auth';
import type {ReactElement, ReactNode} from 'react';

const DEFAULT_PRIVY_APP_ID = 'cmrh69i1o00mw0ckymhuo9qd7';

export function AppProviders({children}: {children: ReactNode}): ReactElement {
  return (
    <PrivyProvider
      appId={process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? DEFAULT_PRIVY_APP_ID}
      config={{
        loginMethods: ['email'],
        appearance: {
          theme: 'dark',
          accentColor: '#f2c94c'
        },
        embeddedWallets: {
          ethereum: {
            createOnLogin: 'users-without-wallets'
          }
        }
      }}
    >
      {children}
    </PrivyProvider>
  );
}
