// Standalone 17891 dashboard for the local OpenAI Tunnel + DC stdio bridge.
// Does not start another MCP instance, remote agent, or tunnel.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';

process.env.DC_STATS_SERVER = 'true';
const base = process.env.LOCALAPPDATA;
if (!base) throw new Error('LOCALAPPDATA is missing');
const modulePath = path.join(base, 'DesktopCommander', 'node_modules', '@wonderwhy-er', 'desktop-commander', 'dist', 'dc-stats-server.js');
if (!existsSync(modulePath)) throw new Error('Patched DC stats module not found: ' + modulePath);
const { dcStats } = await import(pathToFileURL(modulePath).href);
dcStats.start();
console.log('[Anlan stats] standalone dashboard launched; 127.0.0.1:17891');
const stop = async () => { await dcStats.close(); process.exit(0); };
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
