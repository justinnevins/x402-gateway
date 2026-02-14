export const config = {
  port: parseInt(process.env.PORT || '3402'),
  walletAddress: process.env.WALLET_ADDRESS || '',
  facilitatorUrl: process.env.FACILITATOR_URL || 'https://x402.org/facilitator',
  network: process.env.NETWORK || 'eip155:84532', // Base Sepolia (CAIP-2)
  e2bApiKey: process.env.E2B_API_KEY || '',
  version: '0.2.0',
  services: [
    {
      endpoint: 'POST /fetch',
      description: 'Extract readable content from any URL using headless browser',
      price: '$0.001',
      accepts: [
        {
          scheme: 'exact',
          network: 'eip155:84532',
          asset: 'USDC',
        },
      ],
    },
    {
      endpoint: 'POST /execute',
      description: 'Run Python or JavaScript code in an isolated sandbox',
      price: '$0.001',
      accepts: [
        {
          scheme: 'exact',
          network: 'eip155:84532',
          asset: 'USDC',
        },
      ],
    },
  ],
};
