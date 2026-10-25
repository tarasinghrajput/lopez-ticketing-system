import 'dotenv/config';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import concurrently from 'concurrently';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

// This library starts a real mongod. WiredTiger and an explicit dbPath keep data on disk.
if (process.argv.includes('--memory')) {
  process.env.DATA_STORE = 'memory';
  process.env.LOCAL_MONGODB = 'false';
}
let database: MongoMemoryReplSet | undefined;
let shuttingDown = false;
let runners: ReturnType<typeof concurrently> | undefined;
async function portAvailable(port: number) {
  await new Promise<void>((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', () =>
      reject(
        new Error(
          `Port ${port} is already in use. Set LOCAL_MONGODB=false to use your own replica set, or stop the existing local launcher.`,
        ),
      ),
    );
    probe.listen(port, '127.0.0.1', () => probe.close(() => resolve()));
  });
}
async function shutdown(code: number) {
  if (shuttingDown) return;
  shuttingDown = true;
  runners?.commands.forEach((command) => {
    if (!command.exited) command.kill('SIGTERM');
  });
  if (runners) await runners.result.catch(() => undefined);
  if (database) await database.stop({ doCleanup: false, force: false });
  process.exit(code);
}
process.once('SIGINT', () => {
  void shutdown(0);
});
process.once('SIGTERM', () => {
  void shutdown(0);
});
try {
  if (process.env.LOCAL_MONGODB === 'true' && process.env.DATA_STORE === 'mongodb') {
    if (process.env.NODE_ENV === 'production' || process.env.APP_MODE !== 'demo')
      throw new Error('The local database launcher is only for development demo mode.');
    const uri = new URL(
      process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27018/lopez?replicaSet=lopez-rs',
    );
    if (uri.hostname !== '127.0.0.1' || uri.username || uri.password)
      throw new Error(
        'LOCAL_MONGODB requires a loopback development URI without database authentication. Set it to false for Atlas or another server.',
      );
    const port = Number(uri.port || 27018),
      replicaSet = uri.searchParams.get('replicaSet');
    if (!replicaSet) throw new Error('MONGODB_URI must name a replicaSet.');
    await portAvailable(port);
    const dbPath = path.resolve('.data', 'mongodb');
    await mkdir(dbPath, { recursive: true });
    console.log('Starting persistent local MongoDB…');
    database = await MongoMemoryReplSet.create({
      binary: { version: '7.0.24' },
      instanceOpts: [{ port, dbPath, storageEngine: 'wiredTiger' }],
      replSet: {
        count: 1,
        name: replicaSet,
        ip: '127.0.0.1',
        storageEngine: 'wiredTiger',
        spawn: { windowsHide: true },
        dispose: { enabled: false },
      },
    });
    if (database.servers[0].instanceInfo?.port !== port)
      throw new Error('MongoDB could not acquire the configured port.');
    console.log(`MongoDB ready · 127.0.0.1:${port} · persistent data: .data/mongodb`);
  }
  runners = concurrently(
    [
      { name: 'api', command: 'tsx watch server/index.ts', prefixColor: 'yellow' },
      { name: 'web', command: 'vite --host 127.0.0.1 --strictPort', prefixColor: 'cyan' },
    ],
    { killOthersOn: ['failure', 'success'], killSignal: 'SIGTERM', killTimeout: 5000 },
  );
  await runners.result;
  await shutdown(0);
} catch (error) {
  if (!shuttingDown) console.error(error instanceof Error ? error.message : error);
  await shutdown(1);
}
