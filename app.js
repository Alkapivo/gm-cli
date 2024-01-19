#! /usr/bin/env node

import watch from './GMFileWatcher.js';
import path from 'path';
import { program } from 'commander';


program.command('init')
    .description('CLI creator for package-gm.json')
    .action(() => {
      console.log('TODO: CLI creator for package-gm.json')
    });
program.command('watch')
    .description('Watch modules dir and copy code to yyp')
    .action(() => {
      watch(path.normalize(path.join(process.cwd(), 'package-gm.json')))
    });
program.parse();
