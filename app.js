#! /usr/bin/env node

import { watch, sync } from './GMFileWatcher.js';
import path from 'path';
import { program } from 'commander';
import { spawn, execSync } from 'child_process';
import fs from 'fs';
import readline from 'readline';

program.version('25.11.03', '-v, --version, ', 'output the current version');
program.command('init')
  .description('CLI creator for package-gm.json')
  .action(async () => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    const askQuestion = (query) => new Promise(resolve => rl.question(query, resolve));

    try {
      console.log("This utility will walk you through creating a package-gm.json file.");
      console.log("It only covers the most common items, and tries to guess sensible defaults.");

      const projectPath = process.cwd();
      const basename = path.basename(projectPath);
      const version = "1.0.0";
      const propertyPackage = await askQuestion(`package name: (${basename}) `);
      const propertyVersion = await askQuestion(`version: (${version}) `);
      const propertyDescription = await askQuestion('description: ');
      const propertyGamemaker = await askQuestion('gamemaker project path: ');
      const propertyTest = await askQuestion('test command: ');
      const propertyGit = await askQuestion('git repository: ');
      const propertyKeywords = await askQuestion('keywords: ');
      const propertyAuthor = await askQuestion('author: ');
      const propertyLicense = await askQuestion('license: (ISC) ');
      const data = {
        package: propertyPackage === null || propertyPackage === '' ? basename : propertyPackage,
        version: propertyVersion === null || propertyVersion === '' ? version : propertyVersion,
        description: propertyDescription,
        main: propertyGamemaker,
        test: propertyTest,
        git: propertyGit,
        keywords: propertyKeywords,
        author: propertyAuthor,
        license: propertyLicense,
        scripts: {},
        dependencies: {},
      };
      
      const filePath = path.join(projectPath, 'package-gm.json');
      const dataString = JSON.stringify(data, null, 2);

      console.log(`About to write to ${filePath}:\n\n${dataString}\n\n`);
      const response = await askQuestion(`Is this OK? (yes) `)
      if (typeof response === 'string' && (response.includes('y') || response.includes('Y'))) {
        fs.writeFileSync(filePath, dataString, 'utf8');
      } else {
        console.log('Aborted.\n');
      }
    } catch (error) {
      console.error('An error occurred:', error);
    } finally {
      rl.close();
      process.exit(0);
    }
  });
program.command('watch')
  .description('Watch modules dir and copy code to gamemaker project')
  .action(() => {
    watch(path.normalize(path.join(process.cwd(), 'package-gm.json')))
  });
program.command('sync')
  .description('Copy code from modules dir to gamemaker project')
  .action(() => {
    sync(path.normalize(path.join(process.cwd(), 'package-gm.json')))
  });
program.command('install')
  .description('Install dependencies listed in package-gm.json to gm_modules folder')
  .action(function() {
    const packageJsonPath = 'package-gm.json';
    const modulesDir = 'gm_modules';

    if (!fs.existsSync(modulesDir)) {
      fs.mkdirSync(modulesDir);
    }

    const packageData = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    const dependencies = packageData.dependencies;
    Object.entries(dependencies).forEach(([key, dependency]) => {
      const modulePath = path.join(modulesDir, key);
      if (fs.existsSync(modulePath)) {
        try {
          execSync('git rev-parse --is-inside-work-tree', { cwd: modulePath, stdio: 'ignore' });
          console.log(`Syncing ${modulePath} to revision ${dependency.revision}`);
          execSync('git clean -fdx', { cwd: modulePath, stdio: 'inherit' });
          execSync(`git checkout ${dependency.revision}`, { cwd: modulePath, stdio: 'inherit' });
        } catch (error) {
          console.log(`Removing ${modulePath} because it's not a git repository`);
          fs.rmSync(modulePath, { recursive: true, force: true });
          console.log(`Initializing ${modulePath} to revision ${dependency.revision}`);
          execSync(`git clone ${dependency.remote} ${modulePath}`, { stdio: 'inherit' });
          execSync(`git checkout ${dependency.revision}`, { cwd: modulePath, stdio: 'inherit' });
        }
      } else {
        console.log(`Initializing ${modulePath} to revision ${dependency.revision}`);
        execSync(`git clone ${dependency.remote} ${modulePath}`, { stdio: 'inherit' });
        execSync(`git checkout ${dependency.revision}`, { cwd: modulePath, stdio: 'inherit' });
      }
    });

    console.log('All dependencies processed.');
    process.exit(0);
  })
program.command('run')
  .description('Run the script named <foo>')
  .argument('<foo>', 'script name')
  .action((foo) => {
    if (typeof foo !== 'string') {
      console.log(`missing argument`);
      console.log(`Exited with code 1`);
      return process.exit(1);
    }

    const packageJsonPath = 'package-gm.json';
    const packageData = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    const scriptData = packageData.scripts[foo]
    if (typeof scriptData !== 'string') {
      console.log(`script ${foo} wasn't found`);
      console.log(`Exited with code 1`);
      return process.exit(1);
    }

    const shellScript = `#!/bin/bash
    ${scriptData}
    `;
    const bashProcess = spawn("bash", ["-s"], { stdio: ["pipe", "inherit", "inherit"] });
    bashProcess.stdin.write(shellScript);
    bashProcess.stdin.end();
    bashProcess.on("exit", (code) => {
      console.log(`Exited with code ${code}`);
      process.exit(code);
    });
  });
program.command('make')
  .description('Build and run gamemaker project')
  .option('-r, --runtime <type>', 'use VM or YYC runtime', 'VM')
  .option('-t, --target <target>', 'available targets: windows', 'windows')
  .option('-o, --out <path>', 'path to output folder')
  .option('-c, --clean', 'make clean build')
  .option('-l, --launch', 'launch the executable after building')
  .action(function() {
    const options = this.opts();
    const config = {
      runtime: '$GMS_RUNTIME',
      target: '$GMS_TARGET',
      out: '$project_path/out',
      targetExt: 'win',
      clean: 'false',
      launch: 'PackageZip',
    };

    if (options.runtime !== undefined) {
      config.runtime = options.runtime;
    }

    if (options.target !== undefined) {
      config.target = options.target;
      config.targetExt = 'win';
    }

    if (options.out !== undefined) {
      config.out = options.out;
    }

    if (options.clean !== undefined) {
      config.clean = 'true';
    }

    if (options.launch !== undefined) {
      config.launch = 'Run';
    }

    const shellScript = `#!/bin/bash
      function log_info {
        local timestamp=$(date +"%Y-%m-%d %H:%M:%S")
        echo -e "$timestamp INFO   [gm-cli::run] $1"
      }

      function log_error {
        local timestamp=$(date +"%Y-%m-%d %H:%M:%S")
        echo -e "$timestamp ERROR  [gm-cli::run] $1"
      }
      
      gm_cli_env_path=""
      dir=$(realpath "$PWD")
      while [ "$dir" != "/" ]; do
        if [ -f "$dir/gm-cli.env" ]; then
          gm_cli_env_path="$dir/gm-cli.env"
          log_info "Load configuration '$gm_cli_env_path'"
          set -a
          . "$gm_cli_env_path"
          set +a
          break
        fi
        dir=$(dirname "$dir")
      done

      igor_path=$GMS_IGOR_PATH
      if [ -z "$igor_path" ]; then
        log_error "GMS_IGOR_PATH must be defined! exit 1"
        exit 1
      fi

      project_name=$GMS_PROJECT_NAME
      if [ -z "$project_name" ]; then
        log_error "GMS_PROJECT_NAME must be defined! exit 1"
        exit 1
      fi
      
      project_path=$GMS_PROJECT_PATH
      if [ -z "$project_path" ]; then
        log_error "GMS_PROJECT_PATH must be defined! exit 1"
        exit 1
      fi
      project_path=$(realpath $project_path)

      user_path=$GMS_USER_PATH
      if [ -z "$user_path" ]; then
        log_error "GMS_USER_PATH must be defined! exit 1"
        exit 1
      fi
      user_path=$(realpath $user_path)

      runtime_path=$GMS_RUNTIME_PATH
      if [ -z "$runtime_path" ]; then
        log_error "GMS_RUNTIME_PATH must be defined! exit 1"
        exit 1
      fi
      runtime_path=$(realpath $runtime_path)

      runtime=${config.runtime}
      if [ -z "$runtime" ]; then
        log_error "GMS_RUNTIME must be defined! exit 1"
        exit 1
      fi

      target=${config.target}
      if [ -z "$target" ]; then
        log_error "GMS_TARGET must be defined! exit 1"
        exit 1
      fi

      target_ext=${config.targetExt}
      if [ -z "$target_ext" ]; then
        log_error "GMS_TARGET_EXT must be defined! exit 1"
        exit 1
      fi

      out_path=${config.out}
      if [ -z "$out_path" ]; then
        log_error "Invalid output path (out_path: $out_path)! exit 1"
        exit 1
      fi

      clean=${config.clean}
      if [ "$clean" = "true" ]; then
        log_info "Clean '$project_path/tmp/igor'"
        rm -rf $project_path/tmp/igor
        
        log_info "Execute shell command:\n$igor_path \\ \n  --runtimePath="$runtime_path" \\ \n  --runtime=$runtime \\ \n  --project="$\{project_path\}/$\{project_name\}.yyp" \\ \n  -- $target Clean\n"
        $igor_path \
          --runtimePath="$runtime_path" \
          --runtime=$runtime \
          --project="$\{project_path\}/$\{project_name\}.yyp" \
          -- $target Clean
      fi

      log_info "Clean '$out_path'"
      rm -rf $out_path

      log_info "Clean '$\{project_path\}/tmp/igor/out'"
      rm -rf $\{project_path\}/tmp/igor/out

      log_info "Execute shell command:\n$igor_path \\ \n --project="$\{project_path\}/$\{project_name\}.yyp" \\ \n --user="$user_path" \\ \n --runtimePath="$runtime_path" \\ \n --runtime=$runtime \\ \n --cache="$\{project_path\}/tmp/igor/cache" \\ \n --temp="$\{project_path\}/tmp/igor/temp" \\ \n --of="$\{project_path\}/tmp/igor/out/$\{project_name\}.win" \\ \n --tf="$\{out_path\}/$\{project_name\}.zip" \\ \n -- $target ${config.launch}"
      $igor_path \
        --project="$\{project_path\}/$\{project_name\}.yyp" \
        --user="$user_path" \
        --runtimePath="$runtime_path" \
        --runtime=$runtime \
        --cache="$\{project_path\}/tmp/igor/cache" \
        --temp="$\{project_path\}/tmp/igor/temp" \
        --of="$\{project_path\}/tmp/igor/out/$\{project_name\}.win" \
        --tf="$\{out_path\}/$\{project_name\}.zip" \
        -- $target ${config.launch}
      
      exit 0
    `;

    const bashProcess = spawn("bash", ["-s"], { stdio: ["pipe", "inherit", "inherit"] });
    bashProcess.stdin.write(shellScript);
    bashProcess.stdin.end();
    bashProcess.on("exit", (code) => {
      console.log(`Exited with code ${code}`);
      process.exit(code);
    });
  });
program.parse();
