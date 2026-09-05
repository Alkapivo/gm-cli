#! /usr/bin/env node

import { watch, sync } from './GMFileWatcher.js';
import path from 'node:path';
import { Command } from 'commander';
import { spawn, execSync } from 'child_process';
import fs from 'fs';
import readline from 'readline';
import { fileURLToPath } from "node:url";


///@return {[ string | undefined, string | undefined ]}
function parseProgramOptions() {
  const options = program.opts();
  return [ options.package, options.env ]
}

///@params {string} path
///@return {string}
function sanitizePath(path) {
  return path.replaceAll("\\", "/")
}

///@params {string} filename
///@params {integer} maxLevels
///@return {string | null}
function findFileUpwardsSync(filename, maxLevels = 99) {
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

///@params {string | undefined}
///@return {Object}
function getPackageGM(packageFile = undefined) {
  const file = packageFile
    ?? findFileUpwardsSync("package-gm.json")
      ?? (() => { throw new Error('❌ package-gm.json was not found') })();
  
  return {
    file: file,
    data: JSON.parse(fs.readFileSync(file, "utf8")),
  }
}

///@params {Object} packageGM
///@return {string}
function getYYPPathFromPackageGM(packageGM) {
  return sanitizePath(path.join(path.dirname(packageGM.file), packageGM.data.main));
}

///@params {Object} packageGM
function backupPackageGM(packageGM) {
  console.log(`📝 Backup package-gm.json: ${packageGM.file}.old`);
  fs.copyFileSync(packageGM.file, `${packageGM.file}.old`);
}

///@params {Object} packageGM
function savePackageGM(packageGM) {
  fs.writeFileSync(packageGM.file, JSON.stringify(packageGM.data, null, 2), "utf8");
}

///@params {number} value
///@params {number} min
///@params {number} max
///@return P
function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function getPSMonitorRAMCommand(processName, interval, name) {
  const psCommand = `
    \$processName = "${processName}"
    \$interval = ${interval}
    \$reportFile = "${name}"
    \$timestamp = Get-Date -Format "yyyy-MM-dd_hh-mm"
    if (\$reportFile -eq "") {
      \$reportFile = "\$processName_\$timestamp-ram-report.csv"
    }

    if (-not (Test-Path \$reportFile)) {
      "date,RAM_MB" | Out-File -FilePath \$reportFile -Encoding UTF8
    }

    echo "Monitoring RAM usage..."

    while (\$true) {
      \$date = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
      try {
        \$process = Get-Process -Name \$processName -ErrorAction Stop
        \$ramMB = [math]::Round(\$process.WorkingSet64 / 1MB, 2)
        "\$date,\$ramMB" | Out-File -Append -Encoding utf8 -FilePath \$reportFile
        echo "\$date TEST   [${processName}::monitor-ram]: \$ramMB"
      } catch {
        #"\$date,PROCESS_NOT_RUNNING" | Out-File -Append -Encoding utf8 -FilePath \$reportFile
        echo "\$date TEST   [${processName}::monitor-ram]: PROCESS_NOT_RUNNING"
      }

      Start-Sleep -Milliseconds \$interval
    }
  `

  return psCommand
}

function runShellScript(scriptData) {
  const bashProcess = spawn("bash", ["-s"], { stdio: ["pipe", "inherit", "inherit"] });
  bashProcess.stdin.write(`#!/bin/bash\nset -Eeuo pipefail\n${scriptData}`);
  bashProcess.stdin.end();
  bashProcess.on("close", (code) => {
    console.log(`Exited with code ${code}`);
    process.exit(code);
  });
  return bashProcess
}


const packageJson = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "package.json"), "utf-8"));

const program = new Command()
  .version(packageJson.version, '-v, --version, ', 'output the current version')
  .option('-P, --package <package>', 'package file')
  .option('-E, --env <env>', 'environment');

const config = program
  .command('config')
  .description('Manage configuration');

const configSet = config
  .command('set')
  .description('Set config values');

const configUnset = config
  .command('unset')
  .description('Unset config values');

const resource = program
  .command("resource")
  .description("Manage resources");

program
  .command('init')
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
      const version = "0.0.1";
      const propertyPackage = await askQuestion(`package name: (${basename}) `);
      const propertyVersion = await askQuestion(`version: (${version}) `);
      const propertyDescription = await askQuestion('description: ');
      const propertyYYP = await askQuestion('gamemaker project file (.yyp): ');
      const propertyTest = await askQuestion('test command: ');
      const propertyGit = await askQuestion('git repository: ');
      const propertyKeywords = await askQuestion('keywords: ');
      const propertyAuthor = await askQuestion('author: ');
      const propertyLicense = await askQuestion('license: (ISC) ');
      const data = {
        name: propertyPackage === null || propertyPackage === '' 
          ? basename 
          : propertyPackage,
        version: propertyVersion === null || propertyVersion === ''
          ? version 
          : propertyVersion,
        description: propertyDescription,
        main: propertyYYP,
        git: propertyGit,
        keywords: propertyKeywords,
        author: propertyAuthor,
        license: propertyLicense,
        scripts: {
          test: propertyTest
        },
        dependencies: {},
        runtimes: {},
      };

      const[packageFile, envFile] = parseProgramOptions();
      const filePath = path.join(projectPath, packageFile ?? 'package-gm.json');
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

program
  .command('watch')
  .description('Watch modules dir and copy code to gamemaker project')
  .action(() => {
    const[packageFile, envFile] = parseProgramOptions();
    watch(path.normalize(path.join(process.cwd(), packageFile ?? 'package-gm.json')))
  });

program
  .command('sync')
  .description('Copy code from modules dir to gamemaker project')
  .action(() => {
    const[packageFile, envFile] = parseProgramOptions();
    sync(path.normalize(path.join(process.cwd(), packageFile ?? 'package-gm.json')))
  });

program
  .command('install')
  .description('Install dependencies listed in package-gm.json to gm_modules folder')
  .option('-c, --clean', 'remove existing gm_modules')
  .option('-s, --shallow', 'git clone will use depth=1 branch=REVISION')
  .action(function() {
    const options = this.opts();
    const clean = options.clean !== undefined;
    const shallow = options.shallow !== undefined;
    const modulesDir = 'gm_modules';

    if (!fs.existsSync(modulesDir)) {
      fs.mkdirSync(modulesDir);
    } else if (clean) {
      fs.rmdirSync(modulesDir, { recursive: true });
      fs.mkdirSync(modulesDir);
    }

    const [packageFile, envFile] = parseProgramOptions();
    const packageGM = getPackageGM(packageFile)
    const dependencies = packageGM.data.dependencies;
    Object.entries(dependencies).forEach(([key, dependency]) => {
      console.log(`\n📦️ Install ${key}\n===========${"=".repeat(key.length)}`)
      const modulePath = path.join(modulesDir, key);
      const cloneOptions = shallow ? `--depth 1 --branch ${dependency.revision}` : ''
      if (fs.existsSync(modulePath)) {
        try {
          execSync('git rev-parse --is-inside-work-tree', { cwd: modulePath, stdio: 'ignore' });
          console.log(`🌐 Syncing ${modulePath} to revision ${dependency.revision}`);
          execSync('git reset --hard HEAD', { cwd: modulePath, stdio: 'inherit' });
          execSync('git clean -fdx', { cwd: modulePath, stdio: 'inherit' });
          execSync(`git checkout ${dependency.revision}`, { cwd: modulePath, stdio: 'inherit' });
        } catch (error) {
          console.log(`🗑️ Removing ${modulePath} because it's not a git repository`);
          fs.rmSync(modulePath, { recursive: true, force: true });
          console.log(`🔧 Initializing ${modulePath} to revision ${dependency.revision}`);
          execSync(`git clone ${cloneOptions} ${dependency.remote} ${modulePath}`, { stdio: 'inherit' });
          execSync(`git checkout ${dependency.revision}`, { cwd: modulePath, stdio: 'inherit' });
        }
      } else {
        console.log(`🔧 Initializing ${modulePath} to revision ${dependency.revision}`);
        execSync(`git clone ${cloneOptions} ${dependency.remote} ${modulePath}`, { stdio: 'inherit' });
        execSync(`git checkout ${dependency.revision}`, { cwd: modulePath, stdio: 'inherit' });
      }
    });

    console.log('\n\n✅ All dependencies processed.');
    process.exit(0);
  })

program
  .command('run')
  .description('Run the script named <foo>')
  .argument('<foo>', 'script name')
  .action((foo) => {
    if (typeof foo !== 'string') {
      console.log(`missing argument`);
      console.log(`Exited with code 1`);
      return process.exit(1);
    }

    const[packageFile, envFile] = parseProgramOptions();
    const packageGM = getPackageGM(packageFile);
    const scriptData = packageGM.data.scripts[foo];
    if (typeof scriptData !== 'string') {
      console.log(`script ${foo} wasn't found`);
      console.log(`Exited with code 1`);
      return process.exit(1);
    }

    const shellScript = `#!/bin/bash
    cd ${sanitizePath(path.dirname(packageGM.file))}
  
    ${scriptData}
    `;
    runShellScript(shellScript)
  });

program
  .command('generate')
  .description('Generate *.yyp IncludedFiles section')
  .action(function() {
    function getFilesRecursively(dir, root) {
      let files = [];
      for (const entry of fs.readdirSync(dir)) {
        const fullPath = sanitizePath(path.join(dir, entry));
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

    const [packageFile, _envFile] = parseProgramOptions();
    const packageGM = getPackageGM(packageFile);
    /*
    const envFile = _envFile
      ?? findFileUpwardsSync(".gm-cli.env")
        ?? (() => { throw new Error('❌ .gm-cli.env was not found') })();
    const envPath = sanitizePath(path.dirname(envFile));
    const envMap = parseEnvFile(envFile);
    */
    const projectPath = path.dirname(path.join(path.dirname(packageGM.file), sanitizePath(packageGM.data.main)));
    const yypPath = getYYPPathFromPackageGM(packageGM)
    const yypOldPath = `${yypPath}.old`
    const yyp = fs.readFileSync(yypPath, "utf8");
    console.log(`📝 Backup yyp:`, yypOldPath);
    fs.copyFileSync(yypPath, yypOldPath);

    const datafilesPath = sanitizePath(path.join(projectPath, "datafiles"));
    const datafiles = getFilesRecursively(datafilesPath, datafilesPath);
    const replaced = yyp.replace(/"IncludedFiles"\s*:\s*\[(.*?)\]/s, `"IncludedFiles":[
    ${datafiles.join("\n    ")}
  ]`);
    console.log(`📝 Save yyp:`, yypPath);
    fs.writeFileSync(yypPath, replaced, "utf8");
  });

program
  .command('make')
  .description('Build and run gamemaker project')
  .option('-t, --target <target>', 'available targets: windows')
  .option('-r, --runtime <type>', 'use VM or YYC runtime')
  .option('-n, --name <name>', 'The actual file name of the ZIP file that is created')
  .option('-l, --launch', 'launch the executable after building')
  .option('-c, --clean', 'make clean build')
  .option('-p, --projectool', 'Path to ProjectTool.exe')
  .action(function() {
    const [packageFile, envFile] = parseProgramOptions();
    const packageGM = getPackageGM(packageFile)
    const targetMap = new Map([ [ 'windows', 'win' ] ])
    const options = this.opts();
    const config = {
      runtime: '$GM_CLI_DEFAULT_RUNTIME',
      target: '$GM_CLI_DEFAULT_TARGET',
      projectool: '$GM_CLI_PROJECT_TOOL_PATH',
      clean: 'false',
      launch: 'PackageZip',
      name: packageGM.data.name,
      zip: packageGM.data.name,
      yyp: sanitizePath(path.basename(packageGM.data.main)),
      path: sanitizePath(path.join(path.dirname(packageGM.file), path.dirname(packageGM.data.main))),
      env: envFile ?? '',
    };

    if (options.runtime !== undefined) {
      config.runtime = options.runtime;
    }

    if (options.target !== undefined && targetMap.has(options.target)) {
      config.target = options.target;
      config.targetExt = targetMap.get(config.target);
    }

    if (options.projectool !== undefined) {
      config.projectool = options.projectool;
    }

    if (options.clean !== undefined) {
      config.clean = 'true';
    }

    if (options.launch !== undefined) {
      config.launch = 'Run';
    }

    if (options.name !== undefined && typeof options.name === 'string' && options.name.trim() !== '') {
      config.zip = options.name;
    }

    const shellScript = `#!/bin/bash
      function log_info {
        local timestamp=$(date +"%Y-%m-%d %H:%M:%S")
        echo -e "\\\e[90m$timestamp\\\e[0m \\\e[32mINFO\\\e[0m   \\\e[35m[gm-cli::make]\\\e[0m $1"
      }

      function log_error {
        local timestamp=$(date +"%Y-%m-%d %H:%M:%S")
        echo -e "\\\e[90m$timestamp\\\e[0m \\\e[31mERROR\\\e[0m  \\\e[35m[gm-cli::make]\\\e[0m $1"
      }
      
      gm_cli_env_path="${config.env}"
      if [ -z "$gm_cli_env_path" ]; then
        dir=$(realpath "$PWD")
        while [ "$dir" != "/" ]; do
          if [ -f "$dir/.gm-cli.env" ]; then
            gm_cli_env_path="$dir/.gm-cli.env"
            log_info "Load configuration '$gm_cli_env_path'"
            set -a
            . "$gm_cli_env_path"
            set +a
            break
          fi
          dir=$(dirname "$dir")
        done
      else
        log_info "Load configuration '$gm_cli_env_path'"
        set -a
        . "$gm_cli_env_path"
        set +a
      fi

      runtime_path=$GM_CLI_RUNTIME_PATH
      if [ -z "$runtime_path" ]; then
        log_error "GM_CLI_RUNTIME_PATH must be defined! exit 1"
        exit 1
      fi
      runtime_path=$(realpath $runtime_path)

      igor_path="$\{GM_CLI_RUNTIME_PATH%/\}/bin/igor/windows/x64/Igor.exe"
      if [ -z "$igor_path" ]; then
        log_error "GM_CLI_RUNTIME_PATH must be defined! exit 1"
        exit 1
      fi
      igor_path=$(realpath $igor_path)

      project_name=${config.name}
      if [ -z "$project_name" ]; then
        log_error "package-gm.json name field must be defined! exit 1"
        exit 1
      fi
      
      project_yyp=${config.yyp}
      if [ -z "$project_yyp" ]; then
        log_error "package-gm.json yyp field must be defined! exit 1"
        exit 1
      fi

      project_path=${config.path}
      if [ -z "$project_path" ]; then
        log_error "package-gm.json yyp field must be defined! exit 1"
        exit 1
      fi
      project_path=$(realpath $project_path)

      user_path=$GM_CLI_USER_PATH
      if [ -z "$user_path" ]; then
        log_error "GM_CLI_USER_PATH must be defined! exit 1"
        exit 1
      fi
      user_path=$(realpath $user_path)

      runtime=${config.runtime}
      if [ -z "$runtime" ]; then
        log_error "GM_CLI_DEFAULT_RUNTIME must be defined! exit 1"
        exit 1
      fi

      target=${config.target}
      if [ -z "$target" ]; then
        log_error "GM_CLI_DEFAULT_TARGET must be defined! exit 1"
        exit 1
      fi

      zip_name=${config.zip}
      echo $zip_name
      if [ -z "$zip_name" ]; then
        log_error "--name must be defined! exit 1"
        exit 1
      fi

      project_tool=${config.projectool}
      echo $project_tool
      if [ -z "$project_tool" ]; then
        log_error "--projectool must be defined! exit 1"
        exit 1
      fi

      clean=${config.clean}
      if [ "$clean" = "true" ]; then
        log_info "Clean '$project_path/tmp/igor'"
        rm -rf $project_path/tmp/igor
        
        log_info "Execute shell command:\n\\\e[33m$igor_path \\ \n  --runtimePath="$runtime_path" \\ \n  --runtime=$runtime \\ \n  --project="$\{project_path\}/$\{project_yyp\}" \\ \n --projectool="$\{project_tool\}" \\ \n --uf="$user_path"  \\ \n -- $target Clean\n\\\e[0m"
        $igor_path \
          --runtimePath="$runtime_path" \
          --runtime=$runtime \
          --project="$\{project_path\}/$\{project_yyp\}" \
          --projectool="$\{project_tool\}" \
          --uf="$user_path" \
          -- $target Clean | GREP_COLORS='mt=01;31' grep --color=always -E 'Error : |$'
      fi

      log_info "Clean '$\{project_path\}/tmp/igor/out'"
      rm -rf $\{project_path\}/tmp/igor/out

      log_info "Execute shell command:\n\\\e[33m$igor_path \\ \n --project="$\{project_path\}/$\{project_yyp\}" \\ \n --user="$user_path" \\ \n --runtimePath="$runtime_path" \\ \n --runtime=$runtime \\ \n --cache="$\{project_path\}/tmp/igor/cache" \\ \n --temp="$\{project_path\}/tmp/igor/temp" \\ \n --of="$\{project_path\}/tmp/igor/out/$\{project_name\}.win" \\ \n --tf="$\{zip_name\}.zip" \\ \n --projectool="$\{project_tool\}" \\ \n --uf="$user_path" \\ \n -- $target ${config.launch}\\\e[0m"
      $igor_path \
        --project="$\{project_path\}/$\{project_yyp\}" \
        --user="$user_path" \
        --runtimePath="$runtime_path" \
        --runtime=$runtime \
        --cache="$\{project_path\}/tmp/igor/cache" \
        --temp="$\{project_path\}/tmp/igor/temp" \
        --of="$\{project_path\}/tmp/igor/out/$\{project_name\}.win" \
        --tf="$\{zip_name\}.zip" \
        --projectool="$\{project_tool\}" \
        --uf="$user_path" \
        -- $target ${config.launch} | GREP_COLORS='mt=01;31' grep --color=always -E 'Error : |$'

      exit 0
    `;

    runShellScript(shellScript)
  });

program
  .command('env')
  .description('CLI creator for .gm-cli.env')
  .action(async () => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    const askQuestion = (query) => new Promise(resolve => rl.question(query, resolve));

    try {
      console.log("This utility will walk you through creating a .gm-cli.env file.");

      const runtimes = [ "VM", "YYC" ]
      const targets = [ "windows" ]

      const projectPath = process.cwd();
      const propertyDefaultRuntime = await askQuestion('Default runtime [ VM, YYC ]: ');
      const propertyDefaultTarget = await askQuestion('Default target [ windows ]: ');
      const propertyProjectoolPath = await askQuestion('Path to ProjectTool.exe: ');
      const propertyRuntimePath = await askQuestion('Path to gamemaker runtime: ');
      const propertyUserPath = await askQuestion('Path to gamemaker user: ');
      const propertyVsDevCmdPath = await askQuestion('Path to VsDevCmd.bat: ');
      const data = {
        GM_CLI_DEFAULT_RUNTIME: runtimes.includes(propertyDefaultRuntime) ? propertyDefaultRuntime : runtimes[0],
        GM_CLI_DEFAULT_TARGET: runtimes.includes(propertyDefaultTarget) ? propertyDefaultTarget : targets[0],
        GM_CLI_PROJECT_TOOL_PATH: path.normalize(propertyProjectoolPath),
        GM_CLI_RUNTIME_PATH: path.normalize(propertyRuntimePath),
        GM_CLI_USER_PATH: path.normalize(propertyUserPath),
        GM_CLI_VS_DEV_CMD_PATH: path.normalize(propertyVsDevCmdPath),
      };
      
      const [packageFile, envFile] = parseProgramOptions();
      const filePath = envFile ?? path.join(projectPath, '.gm-cli.env');
      const dataString = Object.entries(data)
        .map(([key, value]) => `${key}="${value}"`)
        .join("\n");

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

program
  .command('monitor-ram')
  .description('Monitor RAM usage and save it to csv file')
  .option('-i, --interval <interval>', 'step value in seconds (default = 15)')
  .option('-n, --name <name>', 'name of binary')
  .option('-r, --report <report>', 'name of CSV report file')
  .action((options) => {
    const [packageFile, envFile] = parseProgramOptions();
    const packageGM = getPackageGM(packageFile);
    const interval = clamp((Number.isNaN(Number(options.interval)) ? 15.0 : Number(options.interval)), 1.0 / 60.0, 999.0)
    const name = options.name === undefined ? packageGM.data.name : options.name 
    const report = options.report === undefined ? '' : options.report
    const psCommand = getPSMonitorRAMCommand(name, 1000.0 * interval, report)
    const ps = spawn('powershell.exe', [
      '-NoProfile',
      '-Command',
      psCommand
    ]);

    ps.stdout.on('data', data => {
      console.log(data.toString().replace(/\r?\n$/, ''));
    });

    ps.stderr.on('data', data => {
      console.error(data.toString().replace(/\r?\n$/, ''));
    });

    ps.on('close', code => {
      console.log(`Exited with code ${code}`);
    });
  })

program
  .command('test')
  .description('Run tests')
  .option('-t, --tests <tests>', 'List of paths to json test cases')
  .option('-b, --build <build>', 'Path to executable')
  .option('-m, --monitorRAM', 'Monitor RAM while testing')
  .action((options) => {
    const [packageFile, envFile] = parseProgramOptions();
    const packageGM = getPackageGM(packageFile);

    const shellMonitorRAMScript = options.monitorRAM === undefined ? `` : `
    set -m
    gm-cli monitor-ram --name \$\{EXE_FILE%.exe\} &
    pid=\$!
    trap "kill -- -\$pid 2>/dev/null" EXIT INT TERM
    `;

    const shellBuildScript = options.build !== undefined ? `
    cd ${sanitizePath(path.dirname(options.build))}
    build_name="\$\{PWD##*/\}"
    
    EXE_FILE="${path.basename(options.build)}"
    EXE_COUNT=1
    ` : `
    build_name="${packageGM.data.name}_test"
    rm -rf \$build_name.zip
    rm -rf \$build_name
    gm-cli make --name \$build_name
    unzip \$build_name.zip -d \$build_name
    cd \$build_name

    EXE_FILE=\$(find . -maxdepth 1 -type f -name "*.exe" -printf "%f\n" 2>/dev/null)
    EXE_COUNT=\$(printf "%s\n" "\$EXE_FILE" | grep -c .)
    `;

    const shellTestScript = options.tests === undefined ? `
    TESTS=\$(find . -type f -name "*test.json" -print0 | xargs -0 echo | sed 's/ /, /g')
    ` : `
    TESTS=\"${options.tests}\"
    `

    const shellCommandScript = `
    TIMESTAMP=\$(date +"%Y-%m-%d_%H-%M")
    OUTPUT_FILE="\$\{TIMESTAMP\}_\$\{EXE_FILE%.exe\}_run-test.log"
    COMMAND="./\$EXE_FILE -output \"\$OUTPUT_FILE\" --tests \\\"\$TESTS\\\""
  
    if [ "\$EXE_COUNT" -eq 0 ]; then
      echo "ERROR 1: binary was not found"
      exit 1
    elif [ "\$EXE_COUNT" -gt 1 ]; then
      echo "ERROR 2: found more executables: \$EXE_FILE"
      exit 2
    fi
    `;

    const shellScript = `#!/bin/bash
    cd ${sanitizePath(path.dirname(packageGM.file))}

    ${shellBuildScript}

    ${shellTestScript}

    ${shellCommandScript}

    ${shellMonitorRAMScript}

    eval "\$COMMAND" | cat
    `

    runShellScript(shellScript)
  })

configSet
  .command('dependency <name> <revision>')
  .description('Manage dependencies in package-gm.json')
  .option('--remote <remote>')
  .action((name, revision, options) => {
    const resolve = () => {
      const current = packageGM.data.dependencies[name] ?? {};

      packageGM.data.dependencies[name] = {
        ...current,
        ...(options.remote !== undefined && { remote: options.remote }),
        ...(revision !== undefined && { revision }),
      };

      console.log("🔨  Set dependency", name, "as", packageGM.data.dependencies[name])
    };
  
    const [packageFile, envFile] = parseProgramOptions();
    const packageGM = getPackageGM(packageFile);

    backupPackageGM(packageGM)
    resolve()
    savePackageGM(packageGM)
  });

configSet
  .command('script <name> [command]')
  .description('Manage scripts in package-gm.json')
  .action((name, command = '') => {
    const resolve = () => {
      packageGM.data.scripts[name] = command !== undefined ? command : ''
      console.log("🔨  Set script", name, "as", packageGM.data.scripts[name])
    }

    const [packageFile, envFile] = parseProgramOptions();
    const packageGM = getPackageGM(packageFile);

    backupPackageGM(packageGM)
    resolve()
    savePackageGM(packageGM)
  });

configSet
  .command('runtime <name> [supported]')
  .description('Manage runtimes in package-gm.json')
  .action((name, supported = 'true') => {
    const resolve = () => {
      packageGM.data.runtimes[name] = supported === "false" ? supported : "true"
      console.log("🔨  Set runtime", name, "as", supported === "false" ? "false" : "true")
    }

    const [packageFile, envFile] = parseProgramOptions();
    const packageGM = getPackageGM(packageFile);

    backupPackageGM(packageGM)
    resolve()
    savePackageGM(packageGM)
  });

configUnset
  .command('dependency <name>')
  .description('Remove dependencies from package-gm.json')
  .action((name) => {
    const resolve = () => {
      if (name in packageGM.data.dependencies) {
        console.log("🗑️  Unset dependency", name)
        delete packageGM.data.dependencies[name]
      }
    }

    const [packageFile, envFile] = parseProgramOptions();
    const packageGM = getPackageGM(packageFile);

    backupPackageGM(packageGM)
    resolve()
    savePackageGM(packageGM)
  });

configUnset
  .command('script <name>')
  .description('Remove scripts from package-gm.json')
  .action((name) => {
    const resolve = () => {
      if (name in packageGM.data.scripts) {
        console.log("🗑️  Unset script", name)
        delete packageGM.data.scripts[name]
      }
    }

    const [packageFile, envFile] = parseProgramOptions();
    const packageGM = getPackageGM(packageFile);

    backupPackageGM(packageGM)
    resolve()
    savePackageGM(packageGM)
  });

configUnset
  .command('runtime <name>')
  .description('Remove runtimes from package-gm.json')
  .action((name) => {
    const resolve = () => {
      if (name in packageGM.data.scripts) {
        console.log("🗑️  Unset runtime", name)
        delete packageGM.data.runtimes[name]
      }
    }

    const [packageFile, envFile] = parseProgramOptions();
    const packageGM = getPackageGM(packageFile);

    backupPackageGM(packageGM)
    resolve()
    savePackageGM(packageGM)
  });

resource
  .command("create")
  .description("Create a resource")
  .requiredOption("-t, --type <type>", "Resource type")
  .requiredOption("-n, --name <name>", "Resource name")
  .option("-f, --folder <folder>", "Resource folder")
  .action((options) => {
    const [packageFile, envFile] = parseProgramOptions();
    const packageGM = getPackageGM(packageFile);
    const yypPath = getYYPPathFromPackageGM(packageGM)
    const folderOption = options.folder !== undefined ? `folder=${options.folder}` : ``
    const shellScript = `yy-gm-cli resourcetool eval "resource create type=${options.type} name=${options.name} ${folderOption}" ${yypPath}`
    runShellScript(shellScript)
  });

resource
  .command("update")
  .description("Update a resource property")
  .requiredOption("-e, --expr <expr>", "Resource expression")
  .requiredOption("-v, --value <value>", "New value")
  .action((options) => {
    const [packageFile, envFile] = parseProgramOptions();
    const packageGM = getPackageGM(packageFile);
    const yypPath = getYYPPathFromPackageGM(packageGM)
    const shellScript = `yy-gm-cli resourcetool eval "resource set expr=${options.expr} value=${options.value}" ${yypPath}`
    runShellScript(shellScript)
  });

resource
  .command("get")
  .description("Get a resource")
  .requiredOption("-e, --expr <expr>", "Resource expression")
  .action((options) => {
    const [packageFile, envFile] = parseProgramOptions();
    const packageGM = getPackageGM(packageFile);
    const yypPath = getYYPPathFromPackageGM(packageGM)
    const shellScript = `yy-gm-cli resourcetool eval "resource info expr=${options.expr}" ${yypPath}`
    runShellScript(shellScript)
  });

resource
  .command("delete")
  .description("Delete a resource")
  .requiredOption("-n, --name <name>", "Resource name")
  .option("--type <type>", "Resource type")
  .action((options) => {
    const [packageFile, envFile] = parseProgramOptions();
    const packageGM = getPackageGM(packageFile)
    const yypPath = getYYPPathFromPackageGM(packageGM)
    const typeOptions = options.type !== undefined ? `type=${options.type}` : ``
    const shellScript = `yy-gm-cli resourcetool eval "resource delete name=${options.name} ${typeOptions}" ${yypPath}`
    runShellScript(shellScript)
  });

resource
  .command("list")
  .description("List resources")
  .option("--type <type>", "Resource type")
  .action((options) => {
    const [packageFile, envFile] = parseProgramOptions();
    const packageGM = getPackageGM(packageFile)
    const yypPath = getYYPPathFromPackageGM(packageGM)
    const typeOptions = options.type !== undefined ? `type=${options.type}` : ``
    const shellScript = `yy-gm-cli resourcetool eval "resource list ${typeOptions}" ${yypPath}`
    runShellScript(shellScript)
  });


program.parse(process.argv);
