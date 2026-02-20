export const ALLOWED_COMMANDS = new Set([
  'account_info',
  'tx',
  'ledger',
  'account_lines',
  'account_offers',
  'book_offers',
  'gateway_balances',
  'account_tx',
]);

export interface XrplQueryInput {
  command: string;
  params?: Record<string, any>;
}

/**
 * Execute a read-only XRPL ledger query against the configured WebSocket node.
 * Only whitelisted commands are allowed (no submit or write operations).
 */
export async function queryXrpl(input: XrplQueryInput): Promise<any> {
  const { command, params = {} } = input;

  if (!command || typeof command !== 'string') {
    throw new Error('command is required');
  }

  if (!ALLOWED_COMMANDS.has(command)) {
    throw new Error(
      `Command not allowed. Allowed commands: ${[...ALLOWED_COMMANDS].join(', ')}`
    );
  }

  const wsUrl = process.env.XRPL_NODE_WS || 'ws://xrpl.carbonvibe.com:6006';

  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (fn: () => void) => {
      if (!settled) {
        settled = true;
        fn();
      }
    };

    // Node.js 21+ has native WebSocket global
    const ws = new WebSocket(wsUrl);

    const timeout = setTimeout(() => {
      ws.close();
      settle(() => reject(new Error('XRPL query timed out after 10s')));
    }, 10_000);

    ws.addEventListener('open', () => {
      // Merge command with params fields (XRPL protocol flattens them)
      ws.send(JSON.stringify({ command, ...params }));
    });

    ws.addEventListener('message', (event: MessageEvent) => {
      clearTimeout(timeout);
      ws.close();
      settle(() => {
        try {
          resolve(JSON.parse(event.data as string));
        } catch {
          resolve(event.data);
        }
      });
    });

    ws.addEventListener('error', () => {
      clearTimeout(timeout);
      settle(() => reject(new Error('XRPL WebSocket connection failed')));
    });

    ws.addEventListener('close', (event: CloseEvent) => {
      clearTimeout(timeout);
      // Code 1000 = normal closure (we triggered it after receiving a message)
      if (event.code !== 1000) {
        settle(() =>
          reject(new Error(`XRPL WebSocket closed unexpectedly (code ${event.code})`))
        );
      }
    });
  });
}
