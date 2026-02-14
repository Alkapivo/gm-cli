#! /usr/bin/env node

import { watch, sync } from './GMFileWatcher.js';
import path from 'path';
import { program } from 'commander';
import { spawn, execSync } from 'child_process';
import fs from 'fs';
import readline from 'readline';


program.version('26.02.14', '-v, --version, ', 'output the current version');
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
          execSync('git reset --hard HEAD', { cwd: modulePath, stdio: 'inherit' });
          execSync('git clean -fdx -e', { cwd: modulePath, stdio: 'inherit' });
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
program.command('generate')
  .description('Generate *.yyp IncludedFiles section')
  .action(function() {
    function getFilesRecursively(dir, root) {
      let files = [];
      for (const entry of fs.readdirSync(dir)) {
        const fullPath = path.join(dir, entry).replaceAll("\\", "/");
        if (fs.statSync(fullPath).isDirectory()) {
          files = files.concat(getFilesRecursively(fullPath, root));
        } else {
          const filePath = `datafiles${(fullPath.startsWith(root) ? fullPath.slice(root.length) : fullPath)}`.replaceAll(`/${entry}`, '');
          const line = `{"$GMIncludedFile":"","%Name":"${entry}","CopyToMask":-1,"filePath":"${filePath}","name":"${entry}","resourceType":"GMIncludedFile","resourceVersion":"2.0",},`;
          files.push(line);
        }
      }
      return files;
    }

    function findFileUpwardsSync(filename = "gm-cli.env", maxLevels = 99) {
      let currentDir = process.cwd();
      for (let i = 0; i < maxLevels; i++) {
        const candidate = path.join(currentDir, filename);
        if (fs.existsSync(candidate)) {
          return candidate;
        }

        const parentDir = path.dirname(currentDir);
        if (parentDir === currentDir) {
          break;
        }

        currentDir = parentDir;
      }

      return null;
    }

    function parseEnvFile(filePath) {
      const content = fs.readFileSync(filePath, "utf8");
      const result = new Map();
      content.split(/\r?\n/).forEach(line => {
        line = line.trim();
        if (!line || line.startsWith("#")) {
          return;
        }

        const match = line.match(/^([^=]+)="(.*)"$/);
        if (match) {
          const [, key, value] = match;
          result.set(key.trim(), value);
        }
      });

      return result;
    }

    const envFile = findFileUpwardsSync();
    if (envFile === null) {
      console.error('gm-cli.env was not found')
      return
    }

    const envPath = path.dirname(envFile).replaceAll("\\", "/");
    const envMap = parseEnvFile(envFile);
    if (!envMap.has("GMS_PROJECT_PATH")) {
      console.error(`GMS_PROJECT_PATH was not defined in ${envFile}`)
      return
    }

    if (!envMap.has("GMS_PROJECT_NAME")) {
      console.error(`GMS_PROJECT_NAME was not defined in ${envFile}`)
      return
    }

    const projectPath = path.join(envPath, envMap.get("GMS_PROJECT_PATH")).replaceAll("\\", "/");
    const yypPath = path.join(projectPath, `${envMap.get("GMS_PROJECT_NAME")}.yyp`).replaceAll("\\", "/");
    const yypOldPath = path.join(projectPath, `${envMap.get("GMS_PROJECT_NAME")}.yyp.old`).replaceAll("\\", "/");
    const yyp = fs.readFileSync(yypPath, "utf8");
    fs.copyFileSync(yypPath, yypOldPath);

    const datafilesPath = path.join(projectPath, "datafiles").replaceAll("\\", "/")
    const datafiles = getFilesRecursively(datafilesPath, datafilesPath)
    const replaced = yyp.replace(/"IncludedFiles"\s*:\s*\[(.*?)\]/s, `"IncludedFiles":[
    ${datafiles.join("\n    ")}
  ]`);
    fs.writeFileSync(yypPath, replaced, "utf8");
  });
program.command('make')
  .description('Build and run gamemaker project')
  .option('-t, --target <target>', 'available targets: windows')
  .option('-r, --runtime <type>', 'use VM or YYC runtime')
  .option('-n, --name <name>', 'The actual file name of the ZIP file that is created')
  .option('-l, --launch', 'launch the executable after building')
  .option('-c, --clean', 'make clean build')
  .action(function() {
    const targetMap = new Map([ [ 'windows', 'win' ] ])
    const options = this.opts();
    const config = {
      runtime: '$GMS_RUNTIME',
      target: '$GMS_TARGET',
      targetExt: 'win',
      clean: 'false',
      launch: 'PackageZip',
      name: '$GMS_PROJECT_NAME',
    };

    if (options.runtime !== undefined) {
      config.runtime = options.runtime;
    }

    if (options.target !== undefined && targetMap.has(options.target)) {
      config.target = options.target;
      config.targetExt = targetMap.get(config.target);
    }

    if (options.clean !== undefined) {
      config.clean = 'true';
    }

    if (options.launch !== undefined) {
      config.launch = 'Run';
    }

    if (options.name !== undefined && typeof options.name === 'string' && options.name.trim() !== '') {
      config.name = options.name;
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
      
      project_path=$(dirname "$gm_cli_env_path")/$project_path
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

      zip_name=${config.name}
      echo $zip_name
      if [ -z "$zip_name" ]; then
        log_error "--name must be defined! exit 1"
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

      log_info "Clean '$\{project_path\}/tmp/igor/out'"
      rm -rf $\{project_path\}/tmp/igor/out

      log_info "Execute shell command:\n$igor_path \\ \n --project="$\{project_path\}/$\{project_name\}.yyp" \\ \n --user="$user_path" \\ \n --runtimePath="$runtime_path" \\ \n --runtime=$runtime \\ \n --cache="$\{project_path\}/tmp/igor/cache" \\ \n --temp="$\{project_path\}/tmp/igor/temp" \\ \n --of="$\{project_path\}/tmp/igor/out/$\{project_name\}.win" \\ \n --tf="$\{zip_name\}.zip" \\ \n -- $target ${config.launch}"
      $igor_path \
        --project="$\{project_path\}/$\{project_name\}.yyp" \
        --user="$user_path" \
        --runtimePath="$runtime_path" \
        --runtime=$runtime \
        --cache="$\{project_path\}/tmp/igor/cache" \
        --temp="$\{project_path\}/tmp/igor/temp" \
        --of="$\{project_path\}/tmp/igor/out/$\{project_name\}.win" \
        --tf="$\{zip_name\}.zip" \
        -- $target ${config.launch};

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
