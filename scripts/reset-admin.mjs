#!/usr/bin/env node
// Sets a new random admin password and signs everyone out of the admin panel.
//   docker exec checkmate node scripts/reset-admin.mjs
import { resetAdmin } from '../src/admin-auth.js';

console.log(`Admin password reset. Password: ${resetAdmin()}`);
