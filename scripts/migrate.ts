import { closeDb } from '../src/server/db/client';
import { runMigrations } from '../src/server/db/migrate';

runMigrations()
  .then(() => console.log('migrations applied'))
  .finally(() => closeDb());
