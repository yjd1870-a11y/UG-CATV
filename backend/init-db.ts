import { db, initializeDatabase } from './db';
import { env } from './env';

await initializeDatabase();
console.log(`Database initialized: ${env.databasePath}`);
db.close();
