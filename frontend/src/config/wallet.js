import { createAppKit } from '@reown/appkit/react';
import { EthersAdapter } from '@reown/appkit-adapter-ethers';
import { defineChain } from '@reown/appkit/networks';

// =================================================================
// REPLACE THIS with your own projectId from https://dashboard.reown.com
// Sign up, create a project, copy the Project ID here.
// =================================================================
const REOWN_PROJECT_ID = import.meta.env.VITE_REOWN_PROJECT_ID || 'e2b89dc563814ce818711b10fae02f75';

// 0G Galileo Testnet — custom chain (not in Reown/Viem default list)
const zeroGGalileo = defineChain({
  id: 16602,
  caipNetworkId: 'eip155:16602',
  chainNamespace: 'eip155',
  name: '0G-Galileo-Testnet',
  nativeCurrency: {
    decimals: 18,
    name: '0G',
    symbol: 'A0GI'
  },
  rpcUrls: {
    default: { http: ['https://evmrpc-testnet.0g.ai'] }
  },
  blockExplorers: {
    default: { name: '0G ChainScan', url: 'https://chainscan-galileo.0g.ai' }
  }
});

const metadata = {
  name: 'CogniVault',
  description: 'AI-Governed Yield Optimizer on 0G',
  url: typeof window !== 'undefined' ? window.location.origin : 'https://cognivault.xyz',
  icons: ['https://cognivault.xyz/favicon.svg']
};

// Initialize AppKit once at module level (outside React components)
createAppKit({
  adapters: [new EthersAdapter()],
  networks: [zeroGGalileo],
  metadata,
  projectId: REOWN_PROJECT_ID,
  defaultNetwork: zeroGGalileo,
  features: {
    analytics: false,
    email: false,
    socials: [],
    swaps: false,
    onramp: false
  },
  enableNetworkSwitch: false,
  enableReconnect: true,
  allowUnsupportedChain: true,
  themeMode: 'dark',
  themeVariables: {
    '--w3m-color-mix': '#00f2fe',
    '--w3m-color-mix-strength': 40,
    '--w3m-accent': '#00f2fe',
    '--w3m-background-color': '#080b11'
  }
});

export { zeroGGalileo, REOWN_PROJECT_ID };
