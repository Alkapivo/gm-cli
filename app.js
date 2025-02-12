#! /usr/bin/env node

import { watch, sync } from './GMFileWatcher.js';
import path from 'path';
import { program } from 'commander';
import { spawn } from 'child_process';

program.version('25.02.13', '-v, --version, ', 'output the current version');
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
program.command('sync')
    .description('Copy code to yyp')
    .action(() => {
      sync(path.normalize(path.join(process.cwd(), 'package-gm.json')))
    });
program.command('run')
    .description('Build and run yyp')
    .option('-r, --runtime <type>', 'use VM or YYC runtime', 'VM')
    .option('-t, --target <target>', 'available targets: windows', 'windows')
    .option('-o, --out <path>', 'path to output folder')
    .option('-c, --clean', 'run clean build')
    .action(function() {
      const options = this.opts();
      const config = {
        runtime: '$GMS_RUNTIME',
        target: '$GMS_TARGET',
        out: '$project_path/out',
        targetExt: 'win',
        clean: 'false',
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
    log_error "GMS_IGOR_PATH must be defined! exit 0"
    exit 0
  fi

  project_name=$GMS_PROJECT_NAME
  if [ -z "$project_name" ]; then
    log_error "GMS_PROJECT_NAME must be defined! exit 0"
    exit 0
  fi
  
  project_path=$GMS_PROJECT_PATH
  if [ -z "$project_path" ]; then
    log_error "GMS_PROJECT_PATH must be defined! exit 0"
    exit 0
  fi
  project_path=$(realpath $project_path)

  user_path=$GMS_USER_PATH
  if [ -z "$user_path" ]; then
    log_error "GMS_USER_PATH must be defined! exit 0"
    exit 0
  fi
  user_path=$(realpath $user_path)

  runtime_path=$GMS_RUNTIME_PATH
  if [ -z "$runtime_path" ]; then
    log_error "GMS_RUNTIME_PATH must be defined! exit 0"
    exit 0
  fi
  runtime_path=$(realpath $runtime_path)

  runtime=${config.runtime}
  if [ -z "$runtime" ]; then
    log_error "GMS_RUNTIME must be defined! exit 0"
    exit 0
  fi

  target=${config.target}
  if [ -z "$target" ]; then
    log_error "GMS_TARGET must be defined! exit 0"
    exit 0
  fi

  target_ext=${config.targetExt}
  if [ -z "$target_ext" ]; then
    log_error "GMS_TARGET_EXT must be defined! exit 0"
    exit 0
  fi

  out_path=${config.out}
  if [ -z "$out_path" ]; then
    log_error "Invalid output path (out_path: $out_path)! exit 0"
    exit 0
  fi

  clean=${config.clean}
  if [ "$clean" = "true" ]; then
    log_info "Clean '$project_path/tmp/igor'"
    rm -rf $project_path/tmp/igor
    
    log_info "Execute shell command:\n$igor_path \\ \n  --runtimePath="$runtime_path" \\ \n  --runtime=$runtime \\ \n  --project="$project_path/$\{project_name\}.yyp" \\ \n  -- $target Clean\n"
    $igor_path \
      --runtimePath="$runtime_path" \
      --runtime=$runtime \
      --project="$project_path/$\{project_name\}.yyp" \
      -- $target Clean
  fi

  log_info "Clean '$out_path'"
  rm -rf $out_path

  log_info "Execute shell command:\n$igor_path \\ \n  project="$project_path/$\{project_name\}.yyp" \\ \n  user="$user_path" \\ \n  runtimePath="$runtime_path" \\ \n  runtime=$runtime \\ \n  cache="$project_path/tmp/igor/cache" \\ \n  temp="$project_path/tmp/igor/temp" \\ \n  of="$out_path/$\{project_name\}.win" \\ \n  tf="$out_path/$\{project_name\}.zip" \\ \n  -- $target Run\n"
  $igor_path \
    --project="$project_path/$\{project_name\}.yyp" \
    --user="$user_path" \
    --runtimePath="$runtime_path" \
    --runtime=$runtime \
    --cache="$project_path/tmp/igor/cache" \
    --temp="$project_path/tmp/igor/temp" \
    --of="$out_path/$\{project_name\}.win" \
    --tf="$out_path/$\{project_name\}.zip" \
    -- $target Run
`;

      const bashProcess = spawn("bash", ["-s"], { stdio: ["pipe", "inherit", "inherit"] });
      bashProcess.stdin.write(shellScript);
      bashProcess.stdin.end();
    });
program.parse();
